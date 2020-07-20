import io from 'socket.io-client'
import feathers from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio-client'

import offer from './offer'
import agreement from './agreement'
import { EventProcessor } from '../index'
import { getProcessor } from '../../utils'
import {
  AppOptions,
  BaseEventProcessorOptions,
  CacheEvent,
  Logger
} from '../../definitions'
import { loggingFactory } from '../../logger'

import type { EventsHandler, Processor } from '../../definitions'
import type { ProviderManager } from '../../providers'
import { getObject } from 'sequelize-store'
import Agreement from '../../models/agreement.model'

const logger: Logger = loggingFactory('processor:blockchain')

export class CacheEventsProcessor extends EventProcessor {
    private readonly handlers = [offer, agreement] as EventsHandler<CacheEvent, BaseEventProcessorOptions>[]
    private readonly processor: Processor<CacheEvent>
    private services: Record<string, feathers.Service<any>> = {}

    constructor (offerId: string, manager: ProviderManager, options?: AppOptions) {
      super(offerId, manager, options)

      const processorOptions = {
        processorDeps: { manager: this.manager },
        errorHandler: this.errorHandler,
        errorLogger: logger
      }
      this.processor = this.filterEvents(this.offerId, getProcessor<CacheEvent, BaseEventProcessorOptions>(this.handlers, processorOptions))
    }

    filterEvents (offerId: string, callback: Processor<CacheEvent>): Processor<CacheEvent> {
      return async (event: CacheEvent) => {
        if (event.payload.address === offerId || event.payload.offerId === offerId) await callback(event)
      }
    }

    async initialize (): Promise<void> {
      if (this.initialized) throw new Error('Already Initialized')

      // TODO add cache to config
      const client = feathers()
      const socket = io('http://localhost:3030')
      client.configure(socketio(socket))
      logger.info('in connection to cache')
      this.services = {
        offer: client.service('/storage/v0/offers'),
        agreement: client.service('/storage/v0/agreements')
      }

      this.initialized = true
      return await Promise.resolve()
    }

    async run (): Promise<void> {
      if (!this.initialized) await this.initialize()
      // Subscribe for evenets
      Object
        .values(this.services)
        .forEach(service => {
          service.on('created', this.processor)
          service.on('updated', this.processor)
        })
    }

    async precache (): Promise<void> {
      const precacheLogger = loggingFactory('blockchain:event-processor:precache')

      if (!this.initialized) await this.initialize()

      const [offer] = await this.services.offer.find({ query: { address: this.offerId }, paginate: false })

      if (!offer) throw new Error('Offer not exist')
      const store = getObject()
      store.peerId = offer?.peerId
      store.totalCapacity = offer?.totalCapacity

      const agreements = await this.services.agreement.find({ query: { offerId: this.offerId }, paginate: false })
      for (const agreement of agreements as Array<Agreement>) {
        // Pin/UnPin agreements
        if (agreement.isActive) {
          await this.manager.pin(agreement.dataReference, agreement.size + 1).catch(err => precacheLogger.debug(err))
        } else {
          await this.manager.unpin(agreement.dataReference).catch(err => precacheLogger.debug(err))
        }
        await Agreement.upsert(agreement)
      }
    }

    async stop (): Promise<void> {
      // Unsubscribe from events
      Object
        .values(this.services)
        .forEach(service => {
          service.removeListener('created', this.processor)
          service.removeListener('updated', this.processor)
        })

      return await Promise.resolve()
    }
}
