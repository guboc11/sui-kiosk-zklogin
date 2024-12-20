"use client"
// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCurrentAccount } from '@mysten/dapp-kit';
import { KioskOwnerCap} from '@mysten/kiosk';

import { Loading } from '../components/Base/Loading';
import { KioskCreation } from '../components/Kiosk/KioskCreation';
import { KioskData } from '../components/Kiosk/KioskData';
import { KioskSelector } from '../components/Kiosk/KioskSelector';
import { useOwnedKiosk, } from '../hooks/kiosk';
import { useKioskSelector } from '../hooks/useKioskSelector';
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
import { ZkLoginSignatureInputs} from "@mysten/sui.js/dist/cjs/zklogin/bcs";
import {SerializedSignature} from "@mysten/sui.js/cryptography";
import { useKioskClient } from '../context/KioskClientContext';

function Page() {
	// const currentAccount = useCurrentAccount();



	// const { selected, setSelected, showKioskSelector } = useKioskSelector(currentAccount?.address);

  const [error, setError] = useState<string | null>(null);
  const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);

  const [subjectID, setSubjectID] = useState<string | null>(null);
  const [userSalt, setUserSalt] = useState<string | null>(null);
  const [userAddress, setUserAddress] = useState<string | undefined>(undefined);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [jwtEncoded, setJwtEncoded] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [zkProof, setZkProof] = useState<ZkLoginSignatureInputs | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);
	const [kioskOwnerCaps, setKioskOwnerCaps] = useState<KioskOwnerCap[] | null>(null);
	const [kioskId, setKioskId] = useState<string | null>(null);

	const { selected, setSelected, showKioskSelector } = useKioskSelector(userAddress);
	const kioskClient = useKioskClient();

	useEffect(() => {
		const fetchData = async () => {
			if (userAddress) {
				const { kioskOwnerCaps, kioskIds } = await kioskClient.getOwnedKiosks({ address: userAddress });
				setKioskOwnerCaps(kioskOwnerCaps)
				setKioskId(kioskIds[0])
			}
		}

		fetchData();

	}, [userAddress]);

  const {suiClient} = useSui();


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

    setZkProof((proofResponse.data.zkp as ZkLoginSignatureInputs));
    // setZkProof((proofResponse.data.zkp as ZkLoginInputs));

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

  useEffect(() => {
    if (jwtEncoded && zkProof) {
        // executeTransactionWithZKP();
    }
  }, [jwtEncoded, zkProof]);

  async function executeTransactionWithZKP() {
    setError(null);
    setTransactionInProgress(true);
    const decodedJwt: LoginResponse = jwt_decode(jwtEncoded!) as LoginResponse;
    const {userKeyData, ephemeralKeyPair} = getEphemeralKeyPair();
    const partialZkSignature = zkProof!;

    if (!partialZkSignature || !ephemeralKeyPair || !userKeyData) {
        createRuntimeError("Transaction cannot proceed. Missing critical data.");
        return;
    }

    const txb = new TransactionBlock();

    //Just a simple Demo call to create a little NFT weapon :p
    txb.moveCall({
        target: `0xf8294cd69d69d867c5a187a60e7095711ba237fad6718ea371bf4fbafbc5bb4b::teotest::create_weapon`,  //demo package published on testnet
        arguments: [
            txb.pure("Zero Knowledge Proof Axe 9000"),  // weapon name
            txb.pure(66),  // weapon damage
        ],
    });
    txb.setSender(userAddress!);

    const signatureWithBytes = await txb.sign({client: suiClient, signer: ephemeralKeyPair});

    console.log("Got SignatureWithBytes = ", signatureWithBytes);
    console.log("maxEpoch = ", userKeyData.maxEpoch);
    console.log("userSignature = ", signatureWithBytes.signature);

    const addressSeed = genAddressSeed(BigInt(userSalt!), "sub", decodedJwt.sub, decodedJwt.aud);

    const zkSignature: SerializedSignature = getZkLoginSignature({
        inputs: {
            ...partialZkSignature,
            addressSeed: addressSeed.toString(),
        },
        maxEpoch: userKeyData.maxEpoch,
        userSignature: signatureWithBytes.signature,
    });

    suiClient.executeTransactionBlock({
        transactionBlock: signatureWithBytes.bytes,
        signature: zkSignature,
        options: {
            showEffects: true
        }
    }).then((response) => {
        if (response.effects?.status.status == "success") {
            console.log("Transaction executed! Digest = ", response.digest);
            setTxDigest(response.digest);
            setTransactionInProgress(false);
        } else {
            console.log("Transaction failed! reason = ", response.effects?.status)
            setTransactionInProgress(false);
        }
    }).catch((error) => {
        console.log("Error During Tx Execution. Details: ", error);
        if(error.toString().includes("Signature is not valid")){
            createRuntimeError("Signature is not valid. Please generate a new one by clicking on 'Get new ZK Proof'");
        }
        setTransactionInProgress(false);
    });
  }

	// Return loading state.
	// if (isPending) return <Loading />;

	// if the account doesn't have a kiosk.
	if (!kioskId) {
		if (userAddress && userSalt && jwtEncoded && zkProof) return <KioskCreation userAddress={userAddress} userSalt={userSalt} jwtEncoded={jwtEncoded} zkProof={zkProof}  />;
		else return <div>loading zkp</div>
	}

	// kiosk management screen.
	return (
		<div className=''>
			{userAddress && userSalt && jwtEncoded && zkProof
			&& (
				<div className="ml-10 container">
					{showKioskSelector && selected && kioskOwnerCaps && (
						<div className="px-4">
							<KioskSelector caps={kioskOwnerCaps} selected={selected} setSelected={setSelected} />
						</div>
					)}
					{/* {selected && currentAccount?.address && <KioskData kioskId={selected.kioskId} />} */}
					{selected && true && <KioskData kioskId={kioskId} />}
				</div>
			)}
		</div>
		
	);
}

export default Page;
