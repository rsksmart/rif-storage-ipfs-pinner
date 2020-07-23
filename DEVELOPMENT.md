# Development

> and how to setup your environment

## Repos

 - Storage Smart Contracts: https://github.com/rsksmart/rif-marketplace-storage
 - Storage Development CLI: https://github.com/rsksmart/rif-storage-cli

## Steps

 1. Clone all repos, run `npm install` everywhere.
 1. Start up Ganache
 1. In Smart Contracts repo using `truffle deploy` deploy contracts and note the `StorageManager` contract address.
 1. Go to Storage Development CLI and create an Offer for the given contract address (use the `npm run bin` script)
 1. Go to Pinning Service repo and configure to use it the deployed contract. You can use env. variables, `local.json` or CLI parameters for this.
 1. Run `npm run init` - this will bootstrap IPFS repos in `.repos` folder and configure the ports settings.
 1. In one tab run `npm run ipfs:consumer daemon`
 1. In another tab run `npm run ipfs:provider daemon`
 1. Create Offer. Suggested way is using the Storage Development CLI. Use `npm run bin` and don't forget to configure the correct contract address.
    Note the Offer ID (eq. address of the account from which you have created the Offer)
 1. Run `npm run bin -- --offerId <offerId>` to start the service.

Consumer IPFS API runs on `5002`, Swarms on `4002` and Gateway is on `8081`.

Consumer IPFS API runs on `5003`, Swarms on `4003` and Gateway is on `8082`.
