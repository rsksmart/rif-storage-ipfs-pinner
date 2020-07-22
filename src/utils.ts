import { hexToAscii } from 'web3-utils'

import type {
  BlockchainEvent,
  BlockchainEventsWithProvider,
  EventProcessorOptions,
  GetProcessorOptions,
  EventsHandler,
  Logger,
  Processor,
  StorageEvents,
  HandlersObject
} from './definitions'
import { loggingFactory } from './logger'

const logger = loggingFactory('utils')

export function errorHandler (fn: (...args: any[]) => Promise<void>, logger: Logger): (...args: any[]) => Promise<void> {
  return (...args) => {
    return fn(...args).catch(err => logger.error(err))
  }
}

export function isEventWithProvider (event: BlockchainEvent): event is BlockchainEventsWithProvider {
  return Boolean((event as BlockchainEventsWithProvider).returnValues.provider)
}

export function getProcessor<T extends StorageEvents, O extends EventProcessorOptions> (handlers: EventsHandler<T, O>[], options?: GetProcessorOptions): Processor<T> {
  const errHandler = options?.errorHandler ?? errorHandler
  const processor = async (event: T): Promise<void> => {
    const promises = handlers
      .filter(handler => handler.events.includes(event.event))
      .map(handler => handler.process(event, options?.processorDeps as O))
    await Promise.all(promises)
  }
  return errHandler(processor, options?.errorLogger ?? loggingFactory('processor'))
}

export function isValidEvent (value: string, handlers: object): value is keyof typeof handlers {
  return value in handlers
}

export function buildHandler<T extends StorageEvents, O extends EventProcessorOptions> (handlers: HandlersObject<T, O>, events: string[]): EventsHandler<T, O> {
  return {
    events,
    process: (event: T, options: O): Promise<void> => {
      if (!isValidEvent(event.event, handlers)) {
        return Promise.reject(new Error(`Unknown event ${event.event}`))
      }

      return handlers[event.event](event, options ?? {} as O)
    }
  }
}

/**
 * Utility function for decoding Solidity's byte32 array.
 * @param fileReference
 */
export function decodeByteArray (fileReference: string[]): string {
  return fileReference
    .map(hexToAscii)
    .join('')
    .trim()
    .replace(/\0/g, '') // Remove null-characters
}

export function duplicateObject<T> (obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}
