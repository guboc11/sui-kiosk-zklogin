"use client";
import {useSui} from "@/app/hooks/useSui";
import {GetSaltRequest, LoginResponse, UserKeyData, ZKPPayload, ZKPRequest} from "@/app/types/UsefulTypes";
import axios from "axios";
import {useEffect, useLayoutEffect, useState} from "react";
import jwt_decode from "jwt-decode";
import {genAddressSeed, getZkLoginSignature, jwtToAddress} from '@mysten/zklogin';
import {fromB64} from "@mysten/bcs";
import {toBigIntBE} from "bigint-buffer";
import {Ed25519Keypair} from "@mysten/sui.js/keypairs/ed25519";
import {TransactionBlock} from '@mysten/sui.js/transactions';
import {toast} from "react-hot-toast";
// import { ZkLoginSignatureInputs} from "@mysten/sui.js/dist/cjs/zklogin/bcs";
import { ZkLoginInputs } from "@mysten/sui.js/client";

export default function Page() {
  const [error, setError] = useState<string | null>(null);
  const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);

  const [subjectID, setSubjectID] = useState<string | null>(null);
  const [userSalt, setUserSalt] = useState<string | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [jwtEncoded, setJwtEncoded] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  // const [zkProof, setZkProof] = useState<ZkLoginSignatureInputs | null>(null);
  const [zkProof, setZkProof] = useState<ZkLoginInputs | null>(null);

  const {suiClient} = useSui();

  const MINIMUM_BALANCE = 0.003;

  async function getSalt(subject: string, jwtEncoded: string) {
    const getSaltRequest: GetSaltRequest = {
        subject: subject,
        jwt: jwtEncoded!
    }
    console.log("Getting salt...");
    console.log("Subject = ", subject);
    console.log("jwt = ", jwtEncoded);
    console.log("salt request", getSaltRequest);
    const response = await axios.post('/api/userinfo/get/salt', getSaltRequest);
    console.log("getSalt response = ", response);
    if (response?.data.status == 200) {
        const userSalt = response.data.salt;
        console.log("Salt fetched! Salt = ", userSalt);
        return userSalt;
    } else {
        console.log("Error Getting SALT");
        return null;
    }
  }

  function createRuntimeError(message: string) {
    setError(message);
    console.log(message);
    setTransactionInProgress(false);
  }

  function enoughBalance(userBalance: number) {
    return userBalance > MINIMUM_BALANCE;
}

  async function checkIfAddressHasBalance(address: string): Promise<boolean> {
    console.log("Checking whether address " + address + " has balance...");
    const coins = await suiClient.getCoins({
        owner: address,
    });
    //loop over coins
    let totalBalance = 0;
    for (const coin of coins.data) {
        totalBalance += parseInt(coin.balance);
    }
    totalBalance = totalBalance / 1000000000;  //Converting MIST to SUI
    setUserBalance(totalBalance);
    console.log("total balance = ", totalBalance);
    return enoughBalance(totalBalance);
  }

  function getTestnetAdminSecretKey() {
    return process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY;
  }

  async function giveSomeTestCoins(address: string) {
    setError(null);
    console.log("Giving some test coins to address " + address);
    setTransactionInProgress(true);
    const adminPrivateKey = getTestnetAdminSecretKey();
    if (!adminPrivateKey) {
        createRuntimeError("Admin Secret Key not found. Please set NEXT_PUBLIC_ADMIN_SECRET_KEY environment variable.");
        return
    }
    let adminPrivateKeyArray = Uint8Array.from(Array.from(fromB64(adminPrivateKey)));
    const adminKeypair = Ed25519Keypair.fromSecretKey(adminPrivateKeyArray.slice(1));
    const tx = new TransactionBlock();
    const giftCoin = tx.splitCoins(tx.gas, [tx.pure(30000000)]);

    tx.transferObjects([giftCoin], tx.pure(address));

    const res = await suiClient.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        signer: adminKeypair,
        requestType: "WaitForLocalExecution",
        options: {
            showEffects: true,
        },
    });
    const status = res?.effects?.status?.status;
    if (status === "success") {
        console.log("Gift Coin transfer executed! status = ", status);
        checkIfAddressHasBalance(address);
        setTransactionInProgress(false);
    }
    if (status == "failure") {
        createRuntimeError("Gift Coin transfer Failed. Error = " + res?.effects);
    }
  }

  async function loadRequiredData(encodedJwt: string) {
    //Decoding JWT to get useful Info
    const decodedJwt: LoginResponse = await jwt_decode(encodedJwt!) as LoginResponse;

    setSubjectID(decodedJwt.sub);
    //Getting Salt
    const userSalt = await getSalt(decodedJwt.sub, encodedJwt);
    if (!userSalt) {
        createRuntimeError("Error getting userSalt");
        return;
    }

    //Generating User Address
    const address = jwtToAddress(encodedJwt!, BigInt(userSalt!));

    setUserAddress(address);
    setUserSalt(userSalt!);
    const hasEnoughBalance = await checkIfAddressHasBalance(address);
    if(!hasEnoughBalance){
        await giveSomeTestCoins(address);
        toast.success("We' ve fetched some coins for you, so you can get started with Sui !", {   duration: 8000,} );
    }

    console.log("All required data loaded. ZK Address =", address);
  }

  function getEphemeralKeyPair() {
    const userKeyData: UserKeyData = JSON.parse(localStorage.getItem("userKeyData")!);
    let ephemeralKeyPairArray = Uint8Array.from(Array.from(fromB64(userKeyData.ephemeralPrivateKey!)));
    const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(ephemeralKeyPairArray);
    return {userKeyData, ephemeralKeyPair};
  }

  function printUsefulInfo(decodedJwt: LoginResponse, userKeyData: UserKeyData) {
    console.log("iat  = " + decodedJwt.iat);
    console.log("iss  = " + decodedJwt.iss);
    console.log("sub = " + decodedJwt.sub);
    console.log("aud = " + decodedJwt.aud);
    console.log("exp = " + decodedJwt.exp);
    console.log("nonce = " + decodedJwt.nonce);
    console.log("ephemeralPublicKey b64 =", userKeyData.ephemeralPublicKey);
  }

  async function getZkProof(forceUpdate = false) {
    setError(null);
    setTransactionInProgress(true);
    const decodedJwt: LoginResponse = jwt_decode(jwtEncoded!) as LoginResponse;
    const {userKeyData, ephemeralKeyPair} = getEphemeralKeyPair();

    printUsefulInfo(decodedJwt, userKeyData);

    const ephemeralPublicKeyArray: Uint8Array = fromB64(userKeyData.ephemeralPublicKey);

    const zkpPayload: ZKPPayload =
        {
            jwt: jwtEncoded!,
            extendedEphemeralPublicKey: toBigIntBE(
                Buffer.from(ephemeralPublicKeyArray),
            ).toString(),
            jwtRandomness: userKeyData.randomness,
            maxEpoch: userKeyData.maxEpoch,
            salt: userSalt!,
            keyClaimName: "sub"
        };
    const ZKPRequest: ZKPRequest = {
        zkpPayload,
        forceUpdate
    }
    console.log("about to post zkpPayload = ", ZKPRequest);
    setPublicKey(zkpPayload.extendedEphemeralPublicKey);

    //Invoking our custom backend to delagate Proof Request to Mysten backend.
    // Delegation was done to avoid CORS errors.
    const proofResponse = await axios.post('/api/zkp/get', ZKPRequest);

    if (!proofResponse?.data?.zkp) {
        createRuntimeError("Error getting Zero Knowledge Proof. Please check that Prover Service is running.");
        return;
    }
    console.log("zkp response = ", proofResponse.data.zkp);

    // setZkProof((proofResponse.data.zkp as ZkLoginSignatureInputs));
    setZkProof((proofResponse.data.zkp as ZkLoginInputs));

    setTransactionInProgress(false);
}

  useLayoutEffect(()=>{
    setError(null);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const jwt_token_encoded = hash.get("id_token");

    const userKeyData: UserKeyData = JSON.parse(localStorage.getItem("userKeyData")!);

    if (!jwt_token_encoded) {
        createRuntimeError("Could not retrieve a valid JWT Token!")
        return;
    }

    if (!userKeyData) {
        createRuntimeError("user Data is null");
        return;
    }

    setJwtEncoded(jwt_token_encoded);

    loadRequiredData(jwt_token_encoded);
  },[])


  useEffect(() => {
    if (jwtEncoded && userSalt) {
        console.log("jwtEncoded is defined. Getting ZK Proof...");
        getZkProof();
    }
}, [jwtEncoded, userSalt]);

  return(<div>
    <div>auth</div>

  </div>)
}