// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { toast } from 'react-hot-toast';

import { useCreateKioskMutation } from '../../mutations/kiosk';
import { Button } from '../Base/Button';
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
import { ZkLoginSignatureInputs} from "@mysten/sui.js/dist/cjs/zklogin/bcs";
// import { ZkLoginInputs } from "@mysten/sui.js/client";
import {SerializedSignature} from "@mysten/sui.js/cryptography";
import { useKioskClient } from '../../context/KioskClientContext';
import { Kiosk, KioskTransaction } from '@mysten/kiosk';
import { Transaction } from '@mysten/sui/transactions';
import { useTransactionExecution } from '../../hooks/useTransactionExecution';

export function KioskCreation({userAddress, userSalt, jwtEncoded, zkProof }: { userAddress: string, userSalt: string, jwtEncoded: string, zkProof: ZkLoginSignatureInputs }) {
  const [error, setError] = useState<string | null>(null);
  const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
  const [txDigest, setTxDigest] = useState<string | null>(null);

	const {suiClient} = useSui();

	// const createKiosk = useCreateKioskMutation({
	// 	onSuccess: () => {
	// 		onCreate();
	// 		toast.success('Kiosk created successfully');
	// 	},
	// });

	function createRuntimeError(message: string) {
    setError(message);
    console.log(message);
    setTransactionInProgress(false);
  }

	function getEphemeralKeyPair() {
    const userKeyData: UserKeyData = JSON.parse(localStorage.getItem("userKeyData")!);
    let ephemeralKeyPairArray = Uint8Array.from(Array.from(fromB64(userKeyData.ephemeralPrivateKey!)));
    const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(ephemeralKeyPairArray);
    return {userKeyData, ephemeralKeyPair};
  }

	async function createKioskWithZKP() {
    setError(null);
    setTransactionInProgress(true);
    const decodedJwt: LoginResponse = jwt_decode(jwtEncoded!) as LoginResponse;
    const {userKeyData, ephemeralKeyPair} = getEphemeralKeyPair();
    const partialZkSignature = zkProof!;

    if (!partialZkSignature || !ephemeralKeyPair || !userKeyData) {
			console.log(partialZkSignature)
			console.log(ephemeralKeyPair)
			console.log(userKeyData)
        createRuntimeError("Transaction cannot proceed. Missing critical data.");
        return;
    }

    const txb = new TransactionBlock();

    txb.moveCall({
        target: `0x2::kiosk::default`,  //demo package published on testnet
        arguments: [],
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


	return (
		<div className="min-h-[70vh] container py-24 gap-4 mt-6">
			<div className="lg:w-7/12 mx-auto">
				<h2 className="font-bold text-3xl mb-6">Create a Sui Kiosk</h2>
				<p className="pb-3">
					<strong>There’s no kiosk for your address yet.</strong> Create a kiosk to store your
					digital assets and list them for sale on the Sui network. Anyone can view your kiosk and
					the assets you place in it.
				</p>
				<p className="pb-3">
					The demo app works only on <strong>Sui Testnet.</strong> Make sure that your wallet
					connects to Testnet and that you have at least 1 SUI to cover gas fees. You can get test
					SUI tokens using{' '}
					<a
						href="https://docs.sui.io/build/faucet"
						target="_blank"
						rel="noreferrer"
						className="underline"
					>
						the faucet
					</a>
					.
				</p>
				<p className="pb-3">
					When you click <strong>Create Kiosk</strong>, your wallet opens. Click{' '}
					<strong>Approve</strong> to allow the app to create a kiosk for the connected wallet
					address.
				</p>
				{zkProof &&
					<Button
						// loading={createKiosk.isPending}
						// onClick={() => createKiosk.mutate()}
						onClick={createKioskWithZKP}
						className="mt-3 px-12 bg-blue-400 text-white"
					>
						Create Kiosk
					</Button>
				}
			</div>
		</div>
	);
}
