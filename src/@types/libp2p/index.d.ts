declare module 'libp2p' {
  import { EventEmitter } from 'events'

  export interface Options {
    peerId?: any
    addresses?: {
      listen?: string[]
    }
    config?: {
      peerDiscovery?: {
        bootstrap?: {
          enabled?: boolean
          list?: string[]
        }
      }
    }
    modules?: {
      transport?: any[]
      streamMuxer?: any[]
      connEncryption?: any[]
      peerDiscovery?: any[]
      dht?: any
      pubsub?: any
    }
  }

  export default class Libp2p extends EventEmitter {
    peerId: any

    constructor (config?: Options)

    static create (config?: Options): Promise<Libp2p>;

    start (): Promise<void>

    stop (): Promise<void>

    handle (PROTOCOL: any, handler: any): void

    unhandle (PROTOCOL: any, handler: any): void

    peerStore: {
      get (peerId: any): any
    }

    peerInfo: {
      id: {
        toB58String (): string
      }
    }

    dialProtocol (peerInfo: any, PROTOCOL: string): Promise<{ stream: (data: Buffer) => Promise<void>, protocol: any }>

    pubsub: {
      subscribe (topic: string, onMessage: (message: Buffer) => void): void
      unsubscribe (topic: string, onMessage: (message: Buffer) => void): void
      publish (topic: string, message: Buffer): Promise<void>
      getSubscribers (topic: string): Promise<[]>
    }

    connections: Record<string, Array<{ remoteAddr: { toString: () => {} } }>>
  }
}
