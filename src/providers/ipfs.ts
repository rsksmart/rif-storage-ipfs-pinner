import ipfsClient, { CID, ClientOptions, IpfsClient, multiaddr, Version } from 'ipfs-http-client'
import * as semver from 'semver'
import config from 'config'
import BigNumber from 'bignumber.js'

import type { Provider } from '../definitions'
import { loggingFactory } from '../logger'
import { Job, JobsManager } from '../jobs-manager'
import { HashExceedsSizeError } from '../errors'
import { bytesToMegabytes } from '../utils'
import SwarmModel from '../models/swarm.model'

const logger = loggingFactory('ipfs')

const REQUIRED_IPFS_VERSION = '>=0.5.0'

class PinJob extends Job {
  private readonly hash: string
  private readonly agreementReference: string
  private readonly ipfs: IpfsClient
  private readonly expectedSize: BigNumber
  private swarmAddresses: multiaddr[] | undefined

  constructor (ipfs: IpfsClient, hash: string, expectedSize: BigNumber, agreementReference: string) {
    super(hash, 'ipfs - pin')

    this.agreementReference = agreementReference
    this.expectedSize = expectedSize
    this.ipfs = ipfs
    this.hash = hash
  }

  async getPeer (peerId: string): Promise<{ id: string, addresses: multiaddr[] } | undefined> {
    const peer = await this.ipfs.dht.findPeer(new CID(peerId))

    if (!peer) return undefined
    return {
      ...peer,
      addresses: peer.addrs.map(addr => multiaddr(`${addr.toString()}/p2p/${peer.id}`))
    }
  }

  async pre (): Promise<void> {
    logger.debug('In Pinning Job pre hook')
    const swarm = await SwarmModel.findOne({ where: { agreementReference: this.agreementReference } })

    // Connect to peer if exist
    if (swarm) {
      this.swarmAddresses = (await this.getPeer(swarm.peerId))?.addresses

      if (this.swarmAddresses) await this.ipfs.swarm.connect(this.swarmAddresses)
    }
  }

  async after (): Promise<void> {
    logger.debug('In Pinning Job after hook')

    // Disconnect from peer
    if (this.swarmAddresses) {
      await this.ipfs.swarm.disconnect(this.swarmAddresses)
    }
  }

  async _run (): Promise<void> {
    const hash = this.hash.replace('/ipfs/', '')
    const cid = new CID(hash)

    logger.verbose(`(${hash}) Retrieving size of CID`)
    try {
      const stats = await this.ipfs.object.stat(cid, { timeout: config.get<number | string>('ipfs.sizeFetchTimeout') })

      if (bytesToMegabytes(stats.CumulativeSize).gt(this.expectedSize)) {
        logger.error(`The hash ${hash} has cumulative size of ${bytesToMegabytes(stats.CumulativeSize)} megabytes while it was expected to have ${this.expectedSize} megabytes.`)
        throw new HashExceedsSizeError('The hash exceeds payed size!', new BigNumber(stats.CumulativeSize), this.expectedSize)
      }
    } catch (e) {
      if (e.name === 'TimeoutError') {
        logger.error(`Fetching size of ${hash} timed out!`)
        throw new Error(`Fetching size of ${hash} timed out!`)
      } else {
        throw e
      }
    }

    logger.info(`Pinning hash: ${hash} start`)
    // TODO: For this call there is applied the default 20 minutes timeout. This should be estimated using the size.
    //  https://github.com/ipfs/js-ipfs/blob/master/packages/ipfs-http-client/src/lib/core.js#L113
    await this.ipfs.pin.add(cid) // The data can be big and we don't want to automatically timeout here.
  }
}

export class IpfsProvider implements Provider {
  private readonly ipfs: IpfsClient
  private jobsManager: JobsManager

  constructor (jobsManager: JobsManager, ipfs: IpfsClient) {
    this.ipfs = ipfs
    this.jobsManager = jobsManager
  }

  static async bootstrap (jobsManager: JobsManager, options?: ClientOptions | string): Promise<IpfsProvider> {
    if (!options) {
      // Default location of local node, lets try that one
      options = '/ip4/127.0.0.1/tcp/5001'
    }

    const ipfs = ipfsClient(options)

    let versionObject: Version
    try {
      versionObject = await ipfs.version()
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        throw new Error(`No running IPFS daemon on ${typeof options === 'object' ? JSON.stringify(options) : options}`)
      }

      throw e
    }

    if (!semver.satisfies(versionObject.version, REQUIRED_IPFS_VERSION)) {
      throw new Error(`Supplied IPFS node is version ${versionObject.version} while this utility requires version ${REQUIRED_IPFS_VERSION}`)
    }

    return new this(jobsManager, ipfs)
  }

  /**
   *
   * TODO: Error handling
   * @param hash
   * @param expectedSize
   * @param agreementReference
   */
  async pin (hash: string, expectedSize: BigNumber, agreementReference: string): Promise<void> {
    const job = new PinJob(this.ipfs, hash, expectedSize, agreementReference)
    await this.jobsManager.run(job)
  }

  async unpin (hash: string): Promise<void> {
    logger.info(`Unpinning hash: ${hash}`)
    hash = hash.replace('/ipfs/', '')
    const cid = new CID(hash)
    await this.ipfs.pin.rm(cid)
  }
}
