import commandLineArgs from 'command-line-args'
import commandLineUsage from 'command-line-usage'
import * as fs from 'fs'
import path from 'path'
import { createServiceLogger } from '../../utils/logging'
import SequelizeRepository from '../../database/repositories/sequelizeRepository'
import { sendNodeWorkerMessage } from '../../serverless/utils/nodeWorkerSQS'
import { NodeWorkerIntegrationProcessMessage } from '../../types/mq/nodeWorkerIntegrationProcessMessage'
import IntegrationRepository from '../../database/repositories/integrationRepository'
import IntegrationRunRepository from '../../database/repositories/integrationRunRepository'
import { IntegrationRunState } from '../../types/integrationRunTypes'

const banner = fs.readFileSync(path.join(__dirname, 'banner.txt'), 'utf8')

const log = createServiceLogger()

const options = [
  {
    name: 'integration',
    alias: 'i',
    typeLabel: '{underline integrationId}',
    type: String,
    description:
      'The unique ID of integration that you would like to process. Use comma delimiter when sending multiple integrations.',
  },
  {
    name: 'onboarding',
    alias: 'o',
    description: 'Process integration as if it was onboarding.',
    type: Boolean,
    defaultValue: false,
  },
  {
    name: 'platform',
    alias: 'p',
    description: 'The platform for which we should run all integrations.',
  },
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Print this usage guide.',
  },
]
const sections = [
  {
    content: banner,
    raw: true,
  },
  {
    header: 'Process Integration',
    content: 'Trigger processing of integrations.',
  },
  {
    header: 'Options',
    optionList: options,
  },
]

const usage = commandLineUsage(sections)
const parameters = commandLineArgs(options)

if (parameters.help || (!parameters.integration && !parameters.platform)) {
  console.log(usage)
} else {
  setImmediate(async () => {
    const onboarding = parameters.onboarding
    const options = await SequelizeRepository.getDefaultIRepositoryOptions()

    const runRepo = new IntegrationRunRepository(options)

    if (parameters.platform) {
      const integrations = await IntegrationRepository.findAllActive(parameters.platform)
      for (const i of integrations) {
        const integration = i as any
        log.info({ integrationId: integration.id, onboarding }, 'Triggering SQS message!')

        const existingRun = await runRepo.findLastProcessingRun(integration.id)

        if (existingRun && existingRun.onboarding) {
          log.error('Integration is already processing, skipping!')
          return
        }

        const run = await runRepo.create({
          integrationId: integration.id,
          tenantId: integration.tenantId,
          onboarding,
          state: IntegrationRunState.PENDING,
        })

        await sendNodeWorkerMessage(
          integration.tenantId,
          new NodeWorkerIntegrationProcessMessage(run.id),
        )
      }
    } else {
      const integrationIds = parameters.integration.split(',')
      for (const integrationId of integrationIds) {
        const integration = await options.database.integration.findOne({
          where: { id: integrationId },
        })

        if (!integration) {
          log.error({ integrationId }, 'Integration not found!')
          process.exit(1)
        } else {
          log.info({ integrationId, onboarding }, 'Integration found - triggering SQS message!')

          const existingRun = await runRepo.findLastProcessingRun(integration.id)

          if (existingRun && existingRun.onboarding) {
            log.error('Integration is already processing, skipping!')
          } else {
            const run = await runRepo.create({
              integrationId: integration.id,
              tenantId: integration.tenantId,
              onboarding,
              state: IntegrationRunState.PENDING,
            })

            await sendNodeWorkerMessage(
              integration.tenantId,
              new NodeWorkerIntegrationProcessMessage(run.id),
            )
          }
        }
      }
    }

    process.exit(0)
  })
}
