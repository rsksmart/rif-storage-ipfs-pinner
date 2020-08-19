import chai from 'chai'
import BigNumber from 'bignumber.js'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'
import sinon from 'sinon'
import type Sinon from 'sinon'
import { Sequelize } from 'sequelize-typescript'

import { sequelizeFactory } from '../../src/sequelize'
import { FINISHED_EVENT_NAME, Job, JobsManager } from '../../src/jobs-manager'
import { randomHex } from 'web3-utils'
import { JobState, MessageCodesEnum } from '../../src/definitions'
import JobModel from '../../src/models/job.model'
import { runAndAwaitFirstEvent } from '../../src/utils'
import { HashExceedsSizeError } from '../../src/errors'
import * as channel from '../../src/communication'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect

class StubJob extends Job {
  public stub: Sinon.SinonStub

  constructor () {
    super(`testing job ${randomHex(10)}`)
    this.stub = sinon.stub()
  }

  async _run (): Promise<void> {
    await this.stub()
  }
}

describe('Jobs', function () {
  let sequelize: Sequelize
  let models: JobModel[]
  let channelSpy: Sinon.SinonSpy

  before(async (): Promise<void> => {
    sequelize = await sequelizeFactory()
    channelSpy = sinon.stub(channel, 'broadcast')
  })

  after(function () {
    channelSpy.restore()
  })

  describe('Job class', function () {
    beforeEach(async () => {
      await sequelize.sync({ force: true })
      channelSpy.resetHistory()
    })

    it('should save entity when ran', async () => {
      const job = new StubJob()

      let promiseResolve: Function
      job.stub.returns(new Promise(resolve => { promiseResolve = resolve }))

      expect(job.name).to.eql(job.entity.name)
      expect(job.state).to.eql(JobState.CREATED)

      models = await JobModel.findAll()
      expect(models).to.have.length(0)

      const promise = runAndAwaitFirstEvent(job, FINISHED_EVENT_NAME, () => { job.run() })
        .then(async () => {
          models = await JobModel.findAll()
          expect(models).to.have.length(1)
          expect(models[0].name).to.eql(job.name)
          expect(models[0].state).to.eql(JobState.FINISHED)
          expect(job.stub).to.be.calledOnce()
        })

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.RUNNING)

      promiseResolve!()

      await expect(promise).to.be.fulfilled()
    })

    it('should error out when exception is thrown', async () => {
      const job = new StubJob()
      job.stub.rejects(new Error('testing'))

      await expect(runAndAwaitFirstEvent(job, FINISHED_EVENT_NAME, () => { job.run() })).to.be.rejectedWith('testing')

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.ERRORED)
      expect(job.stub).to.be.calledOnce()
    })

    it('should mark as backedoff when retries', async () => {
      const job = new StubJob()

      await runAndAwaitFirstEvent(job, FINISHED_EVENT_NAME, () => { job.run() })

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.FINISHED)
      expect(models[0].retry).to.be.null()
      expect(job.stub).to.be.calledOnce()

      job.retry(1, 3)

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.BACKOFF)
      expect(models[0].retry).to.eql('1/3')
    })
  })

  describe('Job Manager', function () {
    beforeEach(async () => {
      await sequelize.sync({ force: true })
      channelSpy.resetHistory()
    })

    it('should run a Job', async () => {
      const manager = new JobsManager()
      const job = new StubJob()

      models = await JobModel.findAll()
      expect(models).to.have.length(0)

      await manager.run(job)

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.FINISHED)
      expect(models[0].retry).to.be.null()
      expect(job.stub).to.be.calledOnce()
      expect(channelSpy).to.be.calledTwice()
      expect(channelSpy).calledWith(MessageCodesEnum.I_HASH_START, { hash: job.name })
      expect(channelSpy).calledWith(MessageCodesEnum.I_HASH_PINNED, { hash: job.name })
    })

    it('should retry failed Job', async () => {
      const manager = new JobsManager({ retries: 3 })
      const job = new StubJob()
      job.stub.onCall(0).rejects(new Error('testing'))
      job.stub.onCall(1).rejects(new Error('testing'))
      job.stub.onCall(2).resolves()

      models = await JobModel.findAll()
      expect(models).to.have.length(0)

      await manager.run(job)

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.FINISHED)
      expect(models[0].retry).to.eql('2/3')
      expect(job.stub).to.be.calledThrice()
    })

    it('should throw if all retries fails', async () => {
      const manager = new JobsManager({ retries: 3 })
      const job = new StubJob()
      job.stub.onCall(0).rejects(new Error('testing1'))
      job.stub.onCall(1).rejects(new Error('testing2'))
      job.stub.onCall(2).rejects(new Error('testing3'))

      models = await JobModel.findAll()
      expect(models).to.have.length(0)

      await expect(manager.run(job)).to.be.rejectedWith('testing3')

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.ERRORED)
      expect(models[0].retry).to.eql('2/3')
      expect(job.stub).to.be.calledThrice()
      expect(channelSpy).to.have.callCount(6)
      expect(channelSpy.getCall(0)).calledWith(MessageCodesEnum.I_HASH_START, { hash: job.name })
      expect(channelSpy.getCall(1)).calledWith(MessageCodesEnum.W_HASH_RETRY, {
        hash: job.name,
        retryNumber: 1,
        totalRetries: 3,
        error: 'testing1'
      })
      expect(channelSpy.getCall(2)).calledWith(MessageCodesEnum.I_HASH_START, { hash: job.name })
      expect(channelSpy.getCall(3)).calledWith(MessageCodesEnum.W_HASH_RETRY, {
        hash: job.name,
        retryNumber: 2,
        totalRetries: 3,
        error: 'testing2'
      })
      expect(channelSpy.getCall(4)).calledWith(MessageCodesEnum.I_HASH_START, { hash: job.name })
      expect(channelSpy.getCall(5)).calledWith(MessageCodesEnum.E_GENERAL, {
        hash: job.name,
        error: 'testing3'
      })
    })

    it('should ignore retries if NonRecoverableError', async () => {
      const manager = new JobsManager({ retries: 3 })
      const job = new StubJob()
      job.stub.onCall(0).rejects(new Error('testing1'))
      job.stub.onCall(1).rejects(new HashExceedsSizeError('testing2', new BigNumber(10), new BigNumber(9)))

      models = await JobModel.findAll()
      expect(models).to.have.length(0)

      await expect(manager.run(job)).to.be.rejectedWith('testing2')

      models = await JobModel.findAll()
      expect(models).to.have.length(1)
      expect(models[0].name).to.eql(job.name)
      expect(models[0].state).to.eql(JobState.ERRORED)
      expect(models[0].retry).to.eql('1/3')
      expect(job.stub).to.be.calledTwice()
      expect(channelSpy).to.have.callCount(4)
      expect(channelSpy.getCall(0)).calledWith(MessageCodesEnum.I_HASH_START, { hash: job.name })
      expect(channelSpy.getCall(1)).calledWith(MessageCodesEnum.W_HASH_RETRY, {
        hash: job.name,
        retryNumber: 1,
        totalRetries: 3,
        error: 'testing1'
      })
      expect(channelSpy.getCall(2)).calledWith(MessageCodesEnum.I_HASH_START, { hash: job.name })

      expect(channelSpy.getCall(3)).calledWith(MessageCodesEnum.E_AGREEMENT_SIZE_LIMIT_EXCEEDED, {
        hash: job.name,
        size: new BigNumber(10),
        expectedSize: new BigNumber(9)
      })
    })
  })
})
