import { BN, web3 } from "@project-serum/anchor"

export function isValidAddress(input: string): boolean {
    if (input.length < 32 || input.length > 44)
      return false
    let asciiValue: number
    for (let index=0; index<44; index++) {
      asciiValue = input.charCodeAt(index)
      if (asciiValue>47 && asciiValue<58
          || asciiValue>64 && asciiValue<91
          || asciiValue>96 && asciiValue<123)
          continue
      return false
    }
    if (input.includes("0")
        || input.includes("I")
        || input.includes("O")
        || input.includes("l"))
      return false
    return true
  }
  
  export function isValidNumber(input: string): boolean {
    if (input.length === 0) 
      return false
    let periodFound = false
    let asciiValue: number
    for (let index=0; index<input.length; ++index) {
      if (input[index] === ".") {
        if (periodFound)
          return false
        periodFound = true
        continue
      }
      asciiValue = input.charCodeAt(index)
      if (asciiValue<48 || asciiValue>57)
        return false
    }
    return true
  }

  export type OfferDetails = {
    partyOne: web3.PublicKey,
    partyTwo: web3.PublicKey,
    receiveAccount: web3.PublicKey,
    offerToken: web3.PublicKey,
    offerAmount: BN,
    askToken: web3.PublicKey,
    askAmount: BN,
  }