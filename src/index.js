const express = require('express')
const fs = require("fs")
const { ethers } = require("ethers")
const ERC721EnumberableABI = require("./abi/ERC721Enumerable.json")
const axios = require("axios")
const path = require('path')

const storageFilePath = function (fileType, chain, collection, tokenId) {
    return `./storage/${chain}/${collection}/${tokenId}_${fileType}`
}

const retrieveValidatedInput = function (request) {
    if (!ethers.isAddress(request.params.collection)) {
        throw `Invalid collection`
    }

    return {
        'chain': parseInt(request.params.chain),
        'collection': request.params.collection,
        'id': parseInt(request.params.id)
    }
}

const getName = async function (chain, collection) {
    const nameFilePath = `./name/${chain}/name.json`;
    let nameCache = {};

    // Attempt to read the cache file if it exists
    if (fs.existsSync(nameFilePath)) {
        nameCache = JSON.parse(fs.readFileSync(nameFilePath, { encoding: 'utf-8' }));
        // If the collection name is already cached, return it
        if (nameCache[collection]) {
            console.log(`Collection name retrieved from cache: ${nameCache[collection]}`);
            return nameCache[collection];
        }
    }

    // If the name is not in the cache, fetch it from the blockchain
    const contract = await getContract(chain, collection);
    const collectionName = await contract.name();

    // Update the cache with the new collection name
    nameCache[collection] = collectionName;

    // Make directories recursively if required
    if (!fs.existsSync(path.dirname(nameFilePath))) {
        fs.mkdirSync(path.dirname(nameFilePath), { recursive: true });
    }

    fs.writeFileSync(nameFilePath, JSON.stringify(nameCache, null, 2));
    return collectionName;
}


const getProvider = async function (chain) {
    switch (chain) {
        case 199:
            return new ethers.JsonRpcProvider('https://bittorrent.drpc.org', 199)
            break
        default:
            throw `Chain ID ${chain} is not supported`
    }
}

const getContract = async function (chain, collection) {
    const provider = await getProvider(chain)
    return new ethers.Contract(collection, ERC721EnumberableABI, provider)
}

const getMetadata = async function (input) {
    let filepath = storageFilePath(
        'metadata',
        input.chain,
        input.collection,
        input.id
    )

    if (fs.existsSync(filepath)) {
        console.log(`Metadata retrieved from cache: ${input.collection} #${input.id}`)
        return JSON.parse(fs.readFileSync(filepath, { encoding: 'utf-8' }))
    }

    // Retrieve blockchain data
    const contract = await getContract(input.chain, input.collection)
    const metadataUrl = await contract.tokenURI(input.id)

    // Replace IPFS-type URLs
    const url = metadataUrl.replace('ipfs://', 'https://ipfs.io/ipfs/')
    const metadataRequest = await axios.get(url)
    const metadataJson = JSON.stringify(metadataRequest.data)

    // Make directories recursively if required
    if (!fs.existsSync(path.dirname(filepath))) {
        fs.mkdirSync(path.dirname(filepath), { recursive: true })
    }

    fs.writeFileSync(filepath, metadataJson)
    return metadataRequest.data
}

const main = function () {
    /*
    getProvider(1).then((provider) => {
        provider.on({
            topics: [
                ethers.id("Transfer(address,address,uint256)")
            ]
        }, (event) => {
            console.log(event)
        })
    })*/


    const app = express()

     // Add a health check endpoint
   app.get('/health', (req, res) => {
     res.status(200).json({ status: 'OK' });
   });

   // Update your main route to return a 200 status
   app.get('/', (req, res) => {
     res.status(200).json({ message: 'Server is running' });
   });

    app.get('/owner/:chain/:collection/:id', async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*')
        try {
            const input = retrieveValidatedInput(request)
            const contract = await getContract(input.chain, input.collection)
            const owner = await contract.ownerOf(input.id);
            response.send(JSON.stringify({
                'owner': owner
            }))
        } catch (e) {
            console.log(e)
            response.send(JSON.stringify({
                'error': 'Unable to retrieve owner'
            }))
        }
    })

    app.get('/signature/validate', async (request, response) => {
        response.send(`Not implemented`)
    })

    app.get('/metadata/:chain/:collection/:id', async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*')
        try {
            const input = retrieveValidatedInput(request)
            const metadata = await getMetadata(input)
            response.send(metadata)
        } catch (e) {
            console.log(e)
            response.setHeader('Content-Type', 'application/json')
            response.send(JSON.stringify({
                'error': 'Unable to retrieve metadata'
            }))
        }
    })

    app.get('/image/:chain/:collection/:id', async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*')
        try {
            const input = retrieveValidatedInput(request)
            const metadata = await getMetadata(input)

            let filepath = storageFilePath(
                'image',
                input.chain,
                input.collection,
                input.id
            ) + '.png'

            if (fs.existsSync(filepath)) {
                console.log(`Image retrieved from cache: ${input.collection} #${input.id}`)
                response.setHeader('Content-Type', 'image/png')
                response.write(fs.readFileSync(filepath), 'binary')
                response.end(null, 'binary')
                return
            }

            if (!metadata.image) {
                console.log(metadata)
                throw `Image not available in the metadata`
            }

            const url = metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/')
            const imageContents = await axios.get(url, { responseEncoding: "binary" })

            if (!fs.existsSync(path.dirname(filepath))) {
                fs.mkdirSync(path.dirname(filepath), { recursive: true })
            }

            fs.writeFileSync(filepath, imageContents.data, 'binary')
            response.setHeader('Content-Type', 'image/png')
            response.write(imageContents.data, 'binary')
            response.end(null, 'binary')
        } catch (e) {
            console.log(e)
            response.setHeader('Content-Type', 'application/json')
            response.send(JSON.stringify({
                'error': 'Unable to retrieve image'
            }))
        }
    })

    app.get('/name/:chain/:collection/', async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        try {
            const chain = parseInt(request.params.chain);
            const collection = request.params.collection;

            if (!ethers.isAddress(collection)) {
                throw `Invalid collection address`;
            }

            const name = await getName(chain, collection);
            response.send(JSON.stringify({
                'name': name
            }));
        } catch (e) {
            console.log(e);
            response.setHeader('Content-Type', 'application/json');
            response.status(500).send(JSON.stringify({
                'error': 'Unable to retrieve collection name'
            }));
        }
    });

    app.listen(9001, () => {
        console.log('CDN server started.')
    })
}

main()
