/* eslint-disable dot-notation */
import config from 'config'
import chai from 'chai'
import fs, { unlinkSync } from 'fs'
import sinon from 'sinon'
import dirtyChai from 'dirty-chai'
import { IConfig } from '@oclif/config'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'
import { getObject as getStore, getEndPromise } from 'sequelize-store'
import path from 'path'

import BaseCommand, { sleep } from '../../src/utils'
import * as sequalize from '../../src/sequelize'
import * as store from '../../src/store'
import * as Migration from '../../src/migrations'
import { AppOptions, InitCommandOption } from '../../src/definitions'
import DaemonCommand from '../../src/cli/daemon'
import { sequelizeFactory } from '../../src/sequelize'
import { initStore } from '../../src/store'
import * as initAppModule from '../../src/index'
import Agreement from '../../src/models/agreement.model'
import { mockAgreement } from '../fake-marketplace-service'
import DbMigration from '../../src/migrations'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect

const DATA_DIR = 'dataDir'

class BaseCommandMock extends BaseCommand {
  config: IConfig = { dataDir: DATA_DIR } as IConfig

  setInitOptions (options: InitCommandOption) { this.initOptions = { ...this.defaultInitOptions, ...options } }

  get getIsDbInitialized (): boolean { return this.isDbInitialized }

  get getInitDB () { return this.initDB }

  get getInitCommand () { return this.init }

  get getResolveDbPath () { return this.resolveDbPath }

  run (): PromiseLike<any> {
    return Promise.resolve(undefined)
  }
}

const getBaseCommandMock = () => new BaseCommandMock([], {} as IConfig)

describe('CLI', function () {
  describe('BaseCommand', () => {
    let baseCommand = getBaseCommandMock()

    afterEach(() => {
      sinon.reset()
      baseCommand = getBaseCommandMock()
    })

    describe('initDB', () => {
      const upSpy: sinon.SinonSpy = sinon.spy()
      const syncSpy: sinon.SinonSpy = sinon.spy()
      let sequalizeStub: any
      let sequelizeFactoryStub: sinon.SinonStub
      let initStoreStub: sinon.SinonStub
      let migrationStub: any

      beforeEach(() => {
        baseCommand = getBaseCommandMock()
        sequalizeStub = { sync: syncSpy } as any
        sequelizeFactoryStub = sinon.stub(sequalize, 'sequelizeFactory').returns(sequalizeStub)
        initStoreStub = sinon.stub(store, 'initStore').returns(Promise.resolve())
        migrationStub = sinon.stub(Migration.default, 'getInstance').returns({ up: () => upSpy(), pending: () => Promise.resolve(['01.js']) } as any)
      })
      afterEach(() => {
        syncSpy.resetHistory()
        sequelizeFactoryStub.restore()
        initStoreStub.restore()
        upSpy.resetHistory()
        migrationStub.restore()
      })

      it('should run migrations', async () => {
        expect(baseCommand.getIsDbInitialized).to.be.false()
        await baseCommand.getInitDB('path3', { migrate: true, skipPrompt: true })

        expect(upSpy.called).to.be.true()
      })

      it('should init DB: sync true', async () => {
        expect(baseCommand.getIsDbInitialized).to.be.false()
        await baseCommand.getInitDB('path1', { sync: true })

        expect(sequelizeFactoryStub.calledOnce).to.be.true()
        expect(sequelizeFactoryStub.calledOnceWith('path1')).to.be.true()
        expect(initStoreStub.calledOnceWith(sequalizeStub)).to.be.true()
        expect(syncSpy.calledOnce).to.be.true()
        expect(baseCommand.getIsDbInitialized).to.be.true()
      })
      it('should init DB: sync false', async () => {
        expect(baseCommand.getIsDbInitialized).to.be.false()

        await baseCommand.getInitDB('path', { sync: false })

        expect(sequelizeFactoryStub.calledOnce).to.be.true()
        expect(sequelizeFactoryStub.calledOnceWith('path')).to.be.true()
        expect(initStoreStub.calledOnceWith(sequalizeStub)).to.be.true()
        expect(syncSpy.calledOnce).to.be.false()
        expect(baseCommand.getIsDbInitialized).to.be.true()
      })
    })

    describe('resolvePath', () => {
      const TEST_CASES = [
        // File name
        { db: 'someDbName', resolved: `${process.cwd()}/${DATA_DIR}/someDbName.sqlite` },
        { db: 'someDbName.sqlite', resolved: `${process.cwd()}/${DATA_DIR}/someDbName.sqlite` },
        // Get from config
        { db: '', resolved: `${process.cwd()}/${DATA_DIR}/${config.get('db')}` },
        // Absolute or relative path
        { db: './someFolder/test', resolved: `${process.cwd()}/someFolder/test.sqlite` },
        { db: './someFolder/test.sqlite', resolved: `${process.cwd()}/someFolder/test.sqlite` },
        { db: '/absolutePath/test', resolved: '/absolutePath/test.sqlite' },
        { db: '/absolutePath/test.sqlite', resolved: '/absolutePath/test.sqlite' },
        { db: '/absolutePath', resolved: '/absolutePath.sqlite' },
        { db: '/absolutePath/', rejected: 'Path should include the file name' }
      ]

      TEST_CASES.forEach(({ db, resolved, rejected }) => {
        it(`should resolve ${db ? 'path for --db ' + db : 'from config'}`, () => {
          if (resolved) {
            expect(baseCommand.getResolveDbPath(db)).to.be.eql(resolved)
          } else {
            expect(() => baseCommand.getResolveDbPath(db)).to.throw(rejected)
          }
        })
      })
    })

    describe('initCommand', () => {
      const db = 'test'
      const flags = { db }
      const dbPath = 'testPath'
      const fakeCommand = 'FakeCommand'

      const initDbStub: sinon.SinonStub = sinon.stub()
      const parseWithPromptStub: sinon.SinonStub = sinon.stub()
      const baseConfigStub: sinon.SinonStub = sinon.stub()
      const resolveDbPath: sinon.SinonStub = sinon.stub()
      let fsExistStub: sinon.SinonStub

      beforeEach(() => {
        baseCommand = getBaseCommandMock()
        baseCommand['initDB'] = initDbStub
        baseCommand['resolveDbPath'] = resolveDbPath.returns('testPath')
        baseCommand['parseWithPrompt'] = parseWithPromptStub.returns({ flags })
        baseCommand['baseConfig'] = baseConfigStub.returns(true)
        fsExistStub = sinon.stub(fs, 'existsSync').returns(true)
      })

      afterEach(() => {
        initDbStub.reset()
        parseWithPromptStub.reset()
        baseConfigStub.reset()
        resolveDbPath.reset()
        fsExistStub.restore()
      })

      const baseCheck = (baseCommand: BaseCommandMock) => {
        expect(baseCommand['dbPath']).to.be.eql(dbPath)
        expect(baseCommand['parsedArgs']).to.be.eql({ flags })
        expect(parseWithPromptStub.calledOnceWith(baseCommand.constructor)).to.be.true()
        expect(resolveDbPath.calledOnceWith(db)).to.be.true()
      }

      it('init command: default options', async () => {
        await baseCommand.getInitCommand()

        baseCheck(baseCommand)

        expect(baseConfigStub.calledOnceWith(flags)).to.be.true()
        expect(fsExistStub.calledOnce).to.be.true()
        expect(initDbStub.calledOnceWith(dbPath, { migrate: false, sync: false, skipPrompt: false })).to.be.true()
      })

      it('init command: { db: false }', async () => {
        baseCommand.setInitOptions({ db: undefined })
        await baseCommand.getInitCommand()

        baseCheck(baseCommand)

        expect(baseConfigStub.calledOnceWith(flags)).to.be.true()
        expect(fsExistStub.calledOnce).to.be.true()
        expect(initDbStub.called).to.be.false()
      })

      it('init command: { baseConfig: false }', async () => {
        baseCommand.setInitOptions({ baseConfig: false })
        await baseCommand.getInitCommand()

        baseCheck(baseCommand)

        expect(baseConfigStub.called).to.be.false()
        expect(fsExistStub.calledOnce).to.be.true()
        expect(initDbStub.called).to.be.true()
      })

      it('init command: { serviceRequired: false }', async () => {
        baseCommand.setInitOptions({ serviceRequired: false })
        await baseCommand.getInitCommand()

        baseCheck(baseCommand)

        expect(baseConfigStub.called).to.be.true()
        expect(fsExistStub.called).to.be.false()
        expect(initDbStub.called).to.be.true()
      })

      it('init command: { serviceRequired: true }, db file not found', async () => {
        fsExistStub.restore()
        fsExistStub = sinon.stub(fs, 'existsSync').returns(false)
        baseCommand.setInitOptions({ serviceRequired: true })

        await expect(baseCommand.getInitCommand()).to.eventually.be.rejectedWith(
          Error,
          'Service was not yet initialized, first run \'init\' command!'
        )

        baseCheck(baseCommand)

        expect(baseConfigStub.called).to.be.true()
        expect(fsExistStub.called).to.be.true()
        expect(initDbStub.called).to.be.false()
      })
    })
  })

  describe('daemon', () => {
    it('should restart when appResetCallback is triggered', async () => {
      // Prepare DB and set it to be used
      const dbPath = path.join(__dirname, '..', '..', 'db_test.sqlite')
      try {
        unlinkSync(dbPath)
      } catch (e) {
        // Ignore "not found" errors
        if (e.code !== 'ENOENT') {
          throw e
        }
      }
      process.env.RIFS_DB = dbPath

      // Init the DB
      const sequelize = sequelizeFactory(dbPath)
      const migration = await DbMigration.getInstance(sequelize)
      await migration.up()
      await initStore(sequelize)
      let store = getStore()
      store.offerId = '0x123'
      store.peerId = '0x333'
      await getEndPromise()

      // Let save something to DB so we can assert that the DB was resetted
      const testingAgreement = new Agreement(mockAgreement({ agreementReference: '111' }))
      await testingAgreement.save()

      // Mock the dependencies
      let agreements: Agreement[]
      let appResetCallback = (() => { throw new Error('AppResetCallback was not assigned!') }) as () => void
      const stopSpy = sinon.spy()
      const initAppStub = sinon.stub(initAppModule, 'initApp')
      initAppStub.callsFake((offerId: string, opts: AppOptions): Promise<{ stop: () => void }> => {
        expect(offerId).to.eql('0x123')
        appResetCallback = opts.appResetCallback

        return Promise.resolve({ stop: stopSpy })
      })

      // Launches the Daemon
      // @ts-ignore
      DaemonCommand.run(['--skipPrompt', '--log=verbose']).catch((e) => expect.fail(e))

      await sleep(300)
      agreements = await Agreement.findAll()
      expect(agreements).to.have.length(1)
      expect(agreements[0].agreementReference).to.eql('111')

      appResetCallback() // Trigger reset

      await sleep(100)
      agreements = await Agreement.findAll()
      expect(agreements).to.have.length(0)
      store = getStore() // fetch the new store object
      expect(store.peerId).to.be.undefined()
    })
  })
})
