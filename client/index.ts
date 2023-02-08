import { Program, 
         Idl, 
         web3, 
         AnchorProvider, 
         Wallet, 
         BN } from "@project-serum/anchor"
import * as token from "@solana/spl-token"
import idl from "../target/idl/escrow.json"
import * as fs from "fs"
import promptSync from "prompt-sync"
import { sha256 } from "js-sha256"
import bs58 from "bs58"
import { isValidAddress,
         isValidNumber,
         OfferDetails } from "./helper"
import { Mint, RawAccount } from "@solana/spl-token"

//configurations
const connection = new web3.Connection(web3.clusterApiUrl("devnet"), "confirmed")
const programId = new web3.PublicKey("GR9ho64CPNcvYFFMxd8F3GxgjApBmJc2xR78NRyCYRZ8")

//for taking input
const prompter = promptSync()

//defining types for usage
type TokenAccount = { address: web3.PublicKey,
                      account: token.RawAccount 
                    }

function getUserKeypair(): web3.Keypair| null {
    const filePath = process.argv[2]
    if (!fs.existsSync(filePath)) {
        console.error("The provided user keypair file path is invalid...")
        return null
    }
    const fileContent = fs.readFileSync(filePath, "utf-8")
    let userKeypair: web3.Keypair
    try {
        const secretKey = Uint8Array.from(JSON.parse(fileContent) as number[])
        userKeypair = web3.Keypair.fromSecretKey(secretKey)
        return userKeypair
        } catch (err) {
            return null
        }
}

function main() {
    if (process.argv.length != 3) {
        console.error("Invalid argument count")
        console.log("Usage: ts-node <PATH-TO-THIS-FILE> <PATH-TO-USER-KEYPAIR-FILE>")
        return
    }
    const userKeypair = getUserKeypair()
    if (!userKeypair) {
        console.error("Could not retrieve keypair from the provided file...")
        console.log("Check that the file content is a valid keypair")
        return
    }
    const provider = new AnchorProvider(connection, new Wallet(userKeypair), {})
    const program = new Program(idl as Idl, programId, provider)

    console.log("What would you like to do?")
    console.log("1.Create an offer\n2.Accept an offer\n3.Cancel an offer")
    let input: string = prompter("")
    switch (input) {
        case "1":
            createOffer(program)
            break
        case "2":
            acceptOffer(program)
            break
        case "3":
            closeOffer(program)
            break
        default:
            console.error("Invalid input...")
    }
}
main()

async function createOffer(program: Program) {
    const partyOne = program.provider.publicKey
    // get party 2 for the escrow
    let input: string = prompter("Enter the address of the party you want to trade with: ")
    if (!isValidAddress(input)) {
        console.error("Input does not correspond to a valid address...")
        return
    }
    const partyTwo = new web3.PublicKey(input)

    // get the token that user wants to offer
    input = prompter("Enter the mint address of the token you want to send: ")
    if (!isValidAddress(input)) {
        console.error("Input does not correspond to a valid address...")
        return
    }
    const sendMint = new web3.PublicKey(input)
    let mintInfo: token.Mint
    try {
        mintInfo = await token.getMint(connection, sendMint)
    } catch (error) {
        console.error("Error fetching mint account details, check whether the address corresponds to a mint...")
        return
    }
    console.log("The maximum amount of decimals for the given token is", mintInfo.decimals)

    // fetch user's non-zero balance token accounts for the token mint specified
    let response = await connection.getTokenAccountsByOwner(partyOne, { mint: sendMint })
    if (response.value.length === 0) {
        console.error("You do not have any token account corresponding to the specified mint...")
        return
    }
    let tokenAccounts: TokenAccount[]
                         = response.value.map((ele) => {
                                const account = token.AccountLayout.decode(ele.account.data)
                                return { address: ele.pubkey,
                                         account
                                       }
                            })
    tokenAccounts = tokenAccounts.filter((account) => {
                        return account.account.amount > 0
                    })
    if (tokenAccounts.length === 0) {
        console.error("You do not have any tokens for the specified mint...")
        return
    }

    // let user choose one token account
    let tokenAccount: TokenAccount
    const divisor = 10 ** mintInfo.decimals
    if (tokenAccounts.length === 1) {
        tokenAccount = tokenAccounts[0]
        console.log("Found one token account for the specified mint")
        console.log("Address:", tokenAccount.address.toBase58())
        console.log("Token balance:", Number(tokenAccount.account.amount)/divisor)
    } else {
        console.log("Your token accounts")
        tokenAccounts.forEach((account, index) => {
            console.log("Account", index)
            console.log("Address:", account.address.toBase58())
            console.log("Token balance:", Number(account.account.amount)/divisor)
            console.log("------------------------")
        })
        input = prompter("Enter the account you would like to use: ")
        if (!isValidNumber(input) || input.includes(".") || Number(input)<0 || Number(input)>tokenAccounts.length ) {
            console.error("Provided input is invalid...")
            return
        }
        tokenAccount = tokenAccounts[Number(input)-1]
    }

    // get user's offer amount
    input = prompter("Enter the amount you want to offer: ")
    if (!isValidNumber(input)) {
        console.error("The input does not correspond to a valid number...")
        return
    }
    if (input.includes(".") && Number(input).toString().split(".")[1].length > mintInfo.decimals) {
        console.error(`Maximum ${mintInfo.decimals} decimal places allowed, but you specified more...`)
        return
    }
    const offerAmount = Number(input) * divisor

    // get the mint address of the token user wants in return
    input = prompter("Enter the mint address of token you want in return: ")
    if (!isValidAddress(input)) {
        console.error("Input does not correspond to a valid address...")
        return
    }
    const receiveMint = new web3.PublicKey(input)
    if (sendMint.toBase58() === receiveMint.toBase58()) {
        console.error("Offered token and token wanted in return must be different...")
        return
    }
    let receiveMintInfo: Mint
    try {
        receiveMintInfo = await token.getMint(connection, receiveMint)
    } catch (err) {
        console.error("Error fetching mint details, check whether the address corresponds to a mint or not...")
        return
    }
    console.log("The maximum amount of decimals for the given token is", receiveMintInfo.decimals)

    // get the amount that user wants in return
    input = prompter("Enter the amount of tokens you want in return: ")
    if (!isValidNumber(input)) {
        console.error("The input does not correspond to a valid number...")
        return
    }
    if (input.includes(".") && Number(input).toString().split(".")[1].length > receiveMintInfo.decimals) {
        console.error(`Maximum ${receiveMintInfo.decimals} decimal places allowed, but you specified more...`)
        return
    }
    const askAmount = Number(input) * (10 ** receiveMintInfo.decimals)

    // select users's token account to receive tokens
    let receiveAccount: web3.PublicKey
    response = await connection.getTokenAccountsByOwner(partyOne, { mint: receiveMint })
    if (response.value.length === 0) {
        const ata = await token.getOrCreateAssociatedTokenAccount(connection, getUserKeypair(), receiveMint, partyOne)
        receiveAccount = ata.address
    } else
        receiveAccount = response.value[0].pubkey
    
    // send transaction to create the offer
    await sendCreateOfferTxn({ sendMint, sendAccount: tokenAccount.address, sendAmount: offerAmount},
                             receiveAccount,
                             { partyTwo, askMint: receiveMint, askAmount},
                             program
                             )

}

async function acceptOffer(program: Program) {
    const partyTwo = program.provider.publicKey
    let input: string

    // fetch all the offers made to the user
    const discriminator = Buffer.from(sha256.digest("account:OfferDetails")).subarray(0, 8)
    const offerAccounts = await connection.getProgramAccounts(program.programId, { filters: [
        {
            memcmp: {
                offset: 0,
                bytes: bs58.encode(discriminator)
            }
        },
        {
            memcmp: {
                offset: 40,
                bytes: partyTwo.toBase58()
            }
        }
    ]})
    if (offerAccounts.length === 0) {
        console.error("You do not have any offers at the moment...")
        return
    }
    let offers: OfferDetails[] = []
    for (let index=0, offer: OfferDetails; index<offerAccounts.length; ++index) {
        offer = await program.account.offerDetails.fetch(offerAccounts[index].pubkey) as OfferDetails
        offers.push(offer)
    }

    // prompt user to select one offer to accept
    let toAccept: OfferDetails
    let partyOneMint: Mint
    let partyTwoMint: Mint
    if (offers.length === 1) {
        toAccept = offers[0]
        partyOneMint = await token.getMint(connection, toAccept.offerToken)
        partyTwoMint = await token.getMint(connection, toAccept.askToken)
        console.log("You have only one offer at the moment")
        console.log("Requester:", toAccept.partyOne.toBase58())
        console.log(`Offering ${Number(toAccept.offerAmount)/(10 ** partyOneMint.decimals)} of ${toAccept.offerToken.toBase58()}`)
        console.log(`Wants ${Number(toAccept.askAmount)/(10 ** partyTwoMint.decimals)} of ${toAccept.askToken.toBase58()}`)
        input = prompter("Will you accept this offer? (y/n): ").trim().toLowerCase()
        if (input === "n") {
            console.log("Exiting...")
            return
        } else if (input !== "y") {
            console.error("Invalid input...")
            return
        }
    } else {
        console.log("Your offers at the moment")
        for (let index=0, offer: OfferDetails; index<offers.length; ++index) {
            offer = offers[index]
            partyOneMint = await token.getMint(connection, offer.offerToken)
            partyTwoMint = await token.getMint(connection, offer.askToken)
            console.log("Offer", index+1)
            console.log("Requester:", offer.partyOne.toBase58())
            console.log(`Offering ${Number(offer.offerAmount)/(10 ** partyOneMint.decimals)} of ${offer.offerToken.toBase58()}`)
            console.log(`Wants ${Number(offer.askAmount)/(10 ** partyTwoMint.decimals)} of ${offer.askToken.toBase58()}`)
            console.log("----------------------------------")
        }
        input = prompter("Enter the offer number you want to accept: ")
        if (!isValidNumber(input) || input.includes(".") || Number(input)<1 || Number(input)>offers.length) {
            console.error("Invalid input...")
            return
        }
        toAccept = offers[Number(input)-1]
    }

    // fetch user's token accounts that have sufficient tokens to send
    let response = await connection.getTokenAccountsByOwner(partyTwo, { mint: toAccept.askToken })
    if (response.value.length === 0) {
        console.error("You do not have any token accounts for the requested token...")
        return
    }
    let tokenAccounts: { address: web3.PublicKey,
                         account: RawAccount }[] = response.value.map((ele) => {
                                return { address: ele.pubkey,
                                         account: token.AccountLayout.decode(ele.account.data) }
                                })
    tokenAccounts = tokenAccounts.filter((tokenAccount) => {
        return Number(tokenAccount.account.amount)>=Number(toAccept.askAmount)
    })
    if (tokenAccounts.length === 0) {
        console.error("You do not have enough tokens to accept this trade...")
        return
    }

    // fetch (or create) user's token account to receive tokens from trade
    let receiveAccount: web3.PublicKey
    response = await connection.getTokenAccountsByOwner(partyTwo, { mint: toAccept.offerToken })
    if (response.value.length > 0) {
        receiveAccount = response.value[0].pubkey
    } else {
        try {
           const tokenAccount = await token.getOrCreateAssociatedTokenAccount(connection, getUserKeypair(), toAccept.offerToken, partyTwo)
           receiveAccount = tokenAccount.address 
        } catch (error) {
            console.error("Error creating associated token account for receiving trade tokens...")
            console.log("Check you have enough sol balance")
            return
        }
    }

    // send the accept offer transaction
    await sendAcceptOfferTxn(toAccept, tokenAccounts[0].address, receiveAccount, program)

}

async function closeOffer(program: Program) {
    const partyOne = program.provider.publicKey
    let input: string

    // fetch all the offers created by user
    const discriminator = Buffer.from(sha256.digest("account:OfferDetails")).subarray(0, 8)
    const accounts = await connection.getProgramAccounts(program.programId, { filters: [
        {
            memcmp: {
                offset: 0,
                bytes: bs58.encode(discriminator)
            }
        },
        {
            memcmp: {
                offset: 8,
                bytes: partyOne.toBase58()
            }
        }
    ]
    })
    if (accounts.length === 0) {
        console.log("You do not have any pending offers...")
        return
    }
    let userCreatedOffers: OfferDetails[] = []
    for (let index=0; index<accounts.length; ++index) {
        userCreatedOffers.push(await program.account.offerDetails.fetch(accounts[index].pubkey) as OfferDetails)
    }

    // prompt user to select one offer to close
    let sendMint: Mint
    let receiveMint: Mint
    let toClose: OfferDetails
    if (userCreatedOffers.length === 1) {
        toClose = userCreatedOffers[0]
        sendMint = await token.getMint(connection, toClose.offerToken)
        receiveMint = await token.getMint(connection, toClose.askToken)
        console.log("You have only one pending offer")
        console.log("Party 2:", toClose.partyTwo.toBase58())
        console.log(`Offering ${Number(toClose.offerAmount)/(10 ** sendMint.decimals)} of ${toClose.offerToken.toBase58()}`)
        console.log(`In exchange of ${Number(toClose.askAmount)/(10 ** receiveMint.decimals)} of ${toClose.askToken.toBase58()}`)
        input = prompter("Will you close this offer?(y/n): ").trim().toLowerCase()
        if (input === "n") {
            console.log("Exiting...")
            return
        } else if (input !== "y") {
            console.error("Invalid input...")
            return
        }
    } else {
        console.log("Pending offers")
        for (let index=0, offer: OfferDetails; index<userCreatedOffers.length; ++index) {
            offer = userCreatedOffers[index]
            sendMint = await token.getMint(connection, offer.offerToken)
            receiveMint = await token.getMint(connection, offer.askToken)
            console.log("Offer", index+1)
            console.log("Party 2:", offer.partyTwo.toBase58())
            console.log(`Offering ${Number(offer.offerAmount)/(10 ** sendMint.decimals)} of ${offer.offerToken.toBase58()}`)
            console.log(`In exchange of ${Number(offer.askAmount)/(10 ** receiveMint.decimals)} of ${offer.askToken.toBase58()}`)
            console.log("----------------------------")
        }
        input = prompter("Enter the offer number you would like to close: ")
        if (!isValidNumber(input) || input.includes(".") || Number(input)<1 || Number(input)>userCreatedOffers.length) {
            console.error("Invalid input...")
            return
        }
        toClose = userCreatedOffers[Number(input)-1]
    }

    // send close offer transaction
    await sendCloseOfferTxn(toClose, program)
}

async function sendCreateOfferTxn(sendDetails: { sendMint: web3.PublicKey,
                                                 sendAccount: web3.PublicKey,
                                                 sendAmount: number },
                                  receiveAccount: web3.PublicKey,
                                  askDetails: { partyTwo: web3.PublicKey,
                                                askMint: web3.PublicKey,
                                                askAmount: number },
                                  program: Program) {
    const [authority] = web3.PublicKey.findProgramAddressSync([Buffer.from("authority")], program.programId)
    const tempAccount = token.getAssociatedTokenAddressSync(sendDetails.sendMint, authority, true)
    const [offerDetails] = web3.PublicKey.findProgramAddressSync([Buffer.from("escrow"), program.provider.publicKey.toBuffer(), askDetails.partyTwo.toBuffer()], program.programId)
    const txn = await program.methods.createOffer(new BN(sendDetails.sendAmount),
                                                  new BN(askDetails.askAmount),
                                                  askDetails.partyTwo)
                                .accounts({
                                    partyOne: program.provider.publicKey,
                                    sendMint: sendDetails.sendMint,
                                    sendAccount: sendDetails.sendAccount,
                                    tempAccount,
                                    authority,
                                    receiveMint: askDetails.askMint,
                                    receiveAccount,
                                    offerDetails
                                })
                                .rpc()
    
    console.log(`https://explorer.solana.com/tx/${txn}?cluster=devnet`)
}

async function sendAcceptOfferTxn(offer: OfferDetails, sendAccount: web3.PublicKey, receiveAccount: web3.PublicKey, program: Program) {
    const [authority] = web3.PublicKey.findProgramAddressSync([Buffer.from("authority")], program.programId)
    const tempAccount = token.getAssociatedTokenAddressSync(offer.offerToken, authority, true)
    const [offerDetails] = web3.PublicKey.findProgramAddressSync([Buffer.from("escrow"), offer.partyOne.toBuffer(), offer.partyTwo.toBuffer()], program.programId)
    
    const txn = await program.methods.acceptOffer()
                        .accounts({
                            partyOne: offer.partyOne,
                            partyTwo: offer.partyTwo,
                            offerDetails,
                            authority,
                            partyOneMint: offer.offerToken,
                            partyTwoMint: offer.askToken,
                            tempAccount,
                            partyOneReceive: offer.receiveAccount,
                            partyTwoSend: sendAccount,
                            partyTwoReceive: receiveAccount,
                        })
                        .rpc()
    
    console.log(`https://explorer.solana.com/tx/${txn}?cluster=devnet`)
}

async function sendCloseOfferTxn(offer: OfferDetails, program: Program) {
    const [authority] = web3.PublicKey.findProgramAddressSync([Buffer.from("authority")], program.programId)
    const tempAccount = token.getAssociatedTokenAddressSync(offer.offerToken, authority, true)
    const [offerDetails] = web3.PublicKey.findProgramAddressSync([Buffer.from("escrow"), offer.partyOne.toBuffer(), offer.partyTwo.toBuffer()], program.programId)

    const txn = await program.methods.closeOffer(offer.partyTwo)
                        .accounts({
                            partyOne: offer.partyOne,
                            offerDetails,
                            authority,
                            sendMint: offer.offerToken,
                            tempAccount,
                            receiveAccount: offer.receiveAccount
                        })
                        .rpc()

    console.log(`https://explorer.solana.com/tx/${txn}?cluster=devnet`)
}