// import * as solanaWeb3 from '@solana/web3.js'
const {
    Transaction,
    SystemProgram,
    Keypair,
    Connection,
    sendAndConfirmTransaction,
    clusterApiUrl,
    PublicKey,
    TransactionMessage,
    VersionedTransaction
} = require("@solana/web3.js");
const {
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
    createInitializeMintInstruction,
    getMinimumBalanceForRentExemptMint,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    createBurnCheckedInstruction,
    createMintToCheckedInstruction
} = require("@solana/spl-token");
const { createCreateMetadataAccountV3Instruction } = require("@metaplex-foundation/mpl-token-metadata");
const {
    bundlrStorage,
    keypairIdentity,
    Metaplex
} = require("@metaplex-foundation/js");
const bs58 = require("bs58")

//
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const cors = require('cors');
//

const endpoint =
    "https://aged-few-gas.solana-devnet.quiknode.pro/709859f8e8b4d80991023ddd417b320d0e139e84/" //Replace with your RPC Endpoint
const solanaConnection = new Connection(clusterApiUrl("devnet")) //new Connection(endpoint);

const secretKey =
    "5PSAw83j32BC4MP95Vkrc7SgbezQw6h6Z68ekrUphBzexXaedzgB5XBHx7Ghvp6WZMxZ6BUAqPi1zkXxCjVoDF3k"

const numDecimals = 6

const userWallet = Keypair.fromSecretKey(bs58.decode(secretKey)) //Keypair.fromSecretKey(new Uint8Array(secret));
const metaplex = Metaplex.make(solanaConnection)
    .use(keypairIdentity(userWallet))
    .use(
        bundlrStorage({
            address: "https://devnet.bundlr.network",
            providerUrl: endpoint,
            timeout: 60000
        })
    )

const MINT_CONFIG = {
    numDecimals: numDecimals,
    numberTokens: 100
}

/**
 *
 * @param wallet Solana Keypair
 * @param tokenMetadata Metaplex Fungible Token Standard object
 * @returns Arweave url for our metadata json file
 */
const uploadMetadata = async tokenMetadata => {
    //Upload to Arweave
    const { uri } = await metaplex.nfts().uploadMetadata(tokenMetadata)
    console.log(`Arweave URL: `, uri)
    return uri
}

const createNewMintTransaction = async (
    connection,
    payer,
    mintKeypair,
    destinationWallet,
    mintAuthority,
    freezeAuthority,
    ON_CHAIN_METADATA
) => {
    //Get the minimum lamport balance to create a new account and avoid rent payments
    const requiredBalance = await getMinimumBalanceForRentExemptMint(connection)
    //metadata account associated with mint
    const metadataPDA = await metaplex
        .nfts()
        .pdas()
        .metadata({ mint: mintKeypair.publicKey })
    //get associated token account of your wallet
    const tokenATA = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        destinationWallet
    )

    const createNewTokenTransaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports: requiredBalance,
            programId: TOKEN_PROGRAM_ID
        }),
        createInitializeMintInstruction(
            //Mint Address
            mintKeypair.publicKey, //Number of Decimals of New mint
            MINT_CONFIG.numDecimals, //Mint Authority
            mintAuthority, //Freeze Authority
            freezeAuthority,
            TOKEN_PROGRAM_ID
        ),
        createAssociatedTokenAccountInstruction(
            //Payer
            payer.publicKey, //Associated token account
            tokenATA, //token owner
            payer.publicKey, //Mint
            mintKeypair.publicKey
        ),
        createMintToInstruction(
            //Mint
            mintKeypair.publicKey, //Destination Token Account
            tokenATA, //Authority
            mintAuthority, //number of tokens
            MINT_CONFIG.numberTokens * Math.pow(10, MINT_CONFIG.numDecimals)
        ),
        createCreateMetadataAccountV3Instruction(
            {
                metadata: metadataPDA,
                mint: mintKeypair.publicKey,
                mintAuthority: mintAuthority,
                payer: payer.publicKey,
                updateAuthority: mintAuthority
            },
            {
                createMetadataAccountArgsV3: {
                    data: ON_CHAIN_METADATA,
                    isMutable: true,
                    collectionDetails: null
                }
            }
        )
    )

    return createNewTokenTransaction
}


async function createToken(name, symbol, description, imaUrl) {
    console.log(`---STEP 1: Prepare MetaData---`)
    const MY_TOKEN_METADATA = {
        name: name,
        symbol: symbol,
        description: description,
        image: imaUrl
            // "https://images.ctfassets.net/q5ulk4bp65r7/45uk7WZNNBGCHOwlNaGCT4/a4c8897e2cae08e4f42bf56ca6e3ba4b/solona.png" //add public URL to image you'd like to use
    }
    const ON_CHAIN_METADATA = {
        name: name,
        symbol: symbol,
        uri: "TO_UPDATE_LATER",
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null
    }

    console.log(`---STEP 1: Uploading MetaData---`)
    const userWallet = Keypair.fromSecretKey(bs58.decode(secretKey)) //Keypair.fromSecretKey(new Uint8Array(secret));
    let metadataUri = await uploadMetadata(MY_TOKEN_METADATA)
    ON_CHAIN_METADATA.uri = metadataUri

    console.log(`---STEP 2: Creating Mint Transaction---`)
    let mintKeypair = Keypair.generate()
    console.log(`New Mint Address: `, mintKeypair.publicKey.toString())

    const newMintTransaction = await createNewMintTransaction(
        solanaConnection,
        userWallet,
        mintKeypair,
        userWallet.publicKey,
        userWallet.publicKey,
        userWallet.publicKey,
        ON_CHAIN_METADATA
    )

    console.log(solanaConnection.description)

    console.log(`---STEP 3: Executing Mint Transaction---`)
    let {
        lastValidBlockHeight,
        blockhash
    } = await solanaConnection.getLatestBlockhash("finalized")
    newMintTransaction.recentBlockhash = blockhash
    newMintTransaction.lastValidBlockHeight = lastValidBlockHeight
    newMintTransaction.feePayer = userWallet.publicKey
    const transactionId = await sendAndConfirmTransaction(
        solanaConnection,
        newMintTransaction,
        [userWallet, mintKeypair]
    )
    console.log(`Transaction ID: `, transactionId)
    console.log(
        `Succesfully minted ${MINT_CONFIG.numberTokens} ${
            ON_CHAIN_METADATA.symbol
        } to ${userWallet.publicKey.toString()}.`
    )
    console.log(
        `View Transaction: https://explorer.solana.com/tx/${transactionId}?cluster=devnet`
    )
    console.log(
        `View Token Mint: https://explorer.solana.com/address/${mintKeypair.publicKey.toString()}?cluster=devnet`
    )

    return `View Token Mint: https://explorer.solana.com/address/${mintKeypair.publicKey.toString()}?cluster=devnet`
}

// Configure CORS to allow requests from your frontend origin
const corsOptions = {
    origin: 'https://solana-react-51215b181a0c.herokuapp.com',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // If you are using cookies or sessions
    optionsSuccessStatus: 204,
};


app.use(cors())

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://solana-react-51215b181a0c.herokuapp.com');
    // You can use '*' to allow requests from any origin, but be cautious with this option.
    // res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

app.post('/api/createToken', async (req, res) => {
    console.log(`POST request: `, req.body)
    const { tokenName, tokenSymbol, description, imageUrl } = req.body;
    try {
        // Call the async function to create a token using the provided parameters
        const result = await createToken(tokenName, tokenSymbol, description, imageUrl);
        console.log(result);

        // Your API function logic goes here
        res.json({ message: 'Token created successfully', result });
    } catch (error) {
        console.error('Error in API endpoint:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Server is listening at port: ${port}`);
});
