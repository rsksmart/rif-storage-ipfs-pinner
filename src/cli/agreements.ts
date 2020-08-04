import { flags } from '@oclif/command'
import { Op } from 'sequelize'
import LogSymbols from 'log-symbols'
import Table from 'cli-table3'
import colors from 'colors/safe'

import BaseCommand from '../utils'
import Agreement from '../models/agreement.model'
import { loggingFactory } from '../logger'
import JobModel from '../models/job.model'
import { JobState } from '../definitions'

const logger = loggingFactory('cli:agreements')

type AgreementWithJobs = Agreement & { jobs: JobModel[] }

export default class AgreementsCommand extends BaseCommand {
  static flags = {
    ...BaseCommand.flags,
    filter: flags.string({
      char: 'f',
      description: 'Filter by status',
      options: ['active', 'inactive']
    })
  }

  static description = 'Agreements info'

  static examples = [
    '$ rif-pinning agreements',
    '$ rif-pinning agreements--db myOffer.sqlite',
    '$ rif-pinning agreements --ls -f active',
    '$ rif-pinning agreements --ls -f inactive'
  ]

  static getStatus (agreement: Agreement): string {
    return agreement.isActive ? LogSymbols.success : LogSymbols.error
  }

  static getJobInfo (agreement: AgreementWithJobs): string {
    const [latestJob] = agreement.jobs

    if (!latestJob) return ''

    switch (latestJob.state) {
      case JobState.ERRORED:
        return colors.red(`ERRORED(retries: ${latestJob.retry}) - ${latestJob.errorMessage}`)
      case JobState.FINISHED:
        return colors.green('PINNED')
      default:
        return latestJob.state.toUpperCase()
    }
  }

  static expireIn (agreement: Agreement): string {
    const expired = agreement.expiredIn
    return expired > 0 ? colors.green(`${expired} min`) : colors.red('EXPIRED')
  }

  static prepareAgreementForTable (agreement: AgreementWithJobs): any[] {
    return [
      AgreementsCommand.getStatus(agreement),
      `${agreement.agreementReference} ${agreement.dataReference}`,
      AgreementsCommand.expireIn(agreement),
      AgreementsCommand.getJobInfo(agreement)
    ]
  }

  async queryAgreement (filterStatus?: string): Promise<Array<AgreementWithJobs>> {
    // TODO write raw query to improve performance
    const agreements = await Agreement.findAll() as any[]
    const jobs = await JobModel.findAll({
      raw: true,
      order: [['finish', 'DESC']],
      where: { name: { [Op.in]: agreements.map(a => a.dataReference) } }
    })

    return agreements.reduce(
      (acc, agreement) => {
        agreement = Object.assign(
          agreement,
          {
            jobs: jobs.filter(j => j.name === agreement.dataReference) || [],
            isActive: agreement.hasSufficientFunds
          }
        )

        return [
          ...acc,
          ...(
            (filterStatus === 'active' && agreement.isActive) ||
            (filterStatus === 'inactive' && !agreement.isActive) ||
            !filterStatus
              ? [agreement]
              : []
          )
        ]
      },
      []
    )
  }

  // eslint-disable-next-line require-await
  async run (): Promise<void> {
    const { flags: { filter } } = this.parsedArgs

    const table = new Table({
      head: ['', 'Reference', 'Expire in', 'Pinning Status'].map(t => colors.bold(t)),
      colWidths: [3, 68],
      colAligns: ['center', 'center', 'center', 'left'],
      wordWrap: true,
      style: { head: [] }
    })

    const data = (await this.queryAgreement(filter)).map(AgreementsCommand.prepareAgreementForTable)

    table.push(...data)
    // eslint-disable-next-line no-console
    console.log(table.toString())

    this.exit()
  }
}
