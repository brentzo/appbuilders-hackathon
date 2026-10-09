package ai.yumi.android.bridge

import ai.yumi.android.bridge.BridgeCrypto.Companion.b64
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import java.io.File
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import yumi.protocol.Envelope

/** Reproduces every entry of protocol/vectors/bridge-crypto-v2.json (OBJ-23.2). */
class BridgeCryptoVectorsTest {
    private val crypto = BridgeCrypto(LazySodiumJava(SodiumJava()))
    private val vectors: JsonObject = Json.parseToJsonElement(
        File(System.getProperty("yumi.protocolDir"), "vectors/bridge-crypto-v2.json").readText(),
    ).jsonObject
    private val json = Json { explicitNulls = false }

    private fun JsonObject.s(key: String) = getValue(key).jsonPrimitive.content
    private fun JsonObject.o(key: String) = getValue(key).jsonObject

    private fun device(name: String): DeviceKeys {
        val d = vectors.o("devices").o(name)
        return crypto.keysFromSeeds(d.s("signingSeed").hexToBytes(), d.s("kxSeed").hexToBytes())
    }

    private fun peer(keys: DeviceKeys) = PeerKeys(keys.deviceId, keys.signingPublicKey, keys.kxPublicKey)

    @Test
    fun rfc8032() {
        for (case in vectors.getValue("rfc8032").jsonArray.map { it.jsonObject }) {
            val keys = crypto.keysFromSeeds(case.s("seed").hexToBytes(), ByteArray(32))
            assertEquals(case.s("publicKey"), keys.signingPublicKey.toHex())
            assertEquals(case.s("signature"), crypto.sign(case.s("message").hexToBytes(), keys.signingSecretKey).toHex())
        }
    }

    @Test
    fun xchacha20poly1305() {
        val v = vectors.o("xchacha20poly1305")
        val out = crypto.encrypt(
            v.s("plaintext").toByteArray(), v.s("aad").hexToBytes(), v.s("nonce").hexToBytes(), v.s("key").hexToBytes(),
        )
        assertEquals(v.s("ciphertext") + v.s("tag"), out.toHex())
    }

    @Test
    fun devicesAndSessionKeys() {
        for (name in listOf("mac", "phone")) {
            val d = vectors.o("devices").o(name)
            val keys = device(name)
            assertEquals(d.s("signingPublicKey"), keys.signingPublicKey.toHex())
            assertEquals(d.s("kxPublicKey"), keys.kxPublicKey.toHex())
            assertEquals(d.s("deviceId"), keys.deviceId)
        }
        val mac = device("mac")
        val phone = device("phone")
        val s = vectors.o("sessionKeys")
        val phoneSession = crypto.sessionKeys(phone, peer(mac))
        val macSession = crypto.sessionKeys(mac, peer(phone))
        assertEquals(s.o("phone").s("rx"), phoneSession.rx.toHex())
        assertEquals(s.o("phone").s("tx"), phoneSession.tx.toHex())
        assertEquals(s.o("mac").s("rx"), macSession.rx.toHex())
        assertEquals(s.o("mac").s("tx"), macSession.tx.toHex())
    }

    @Test
    fun canonical() {
        val c = vectors.o("canonical")
        val fields = c.getValue("fields").jsonArray.map { it.jsonPrimitive.content }
        assertEquals(c.s("bytes"), BridgeCrypto.canonical(*fields.toTypedArray()).toHex())
    }

    @Test
    fun envelopesSealAndOpen() {
        for (case in vectors.getValue("envelopes").jsonArray.map { it.jsonObject }) {
            val expected = json.decodeFromJsonElement(Envelope.serializer(), case.o("envelope"))
            val sender = device(case.s("sender"))
            val receiver = device(if (case.s("sender") == "mac") "phone" else "mac")
            assertEquals(case.s("additionalData"), BridgeCrypto.envelopeAdditionalData(expected).toHex())
            assertEquals(case.s("signingBytes"), BridgeCrypto.envelopeSigningBytes(expected, expected.payload).toHex())
            val sealed = crypto.sealEnvelope(
                sender, peer(receiver), expected.type, expected.expiresAt, case.s("plaintext"), expected.id, case.s("nonce").hexToBytes(),
            )
            assertEquals(expected, sealed)
            val opened = crypto.openEnvelope(expected, receiver, peer(sender), Instant.parse(case.s("openAt")))
            assertTrue(opened is OpenResult.Opened)
            assertEquals(case.s("plaintext"), (opened as OpenResult.Opened).plaintext)
            // After its expiry it is still authentic, but never run.
            assertTrue(crypto.openEnvelope(expected, receiver, peer(sender), Instant.parse(expected.expiresAt)) is OpenResult.Expired)
            // A tampered payload fails the signature.
            val tampered = expected.copy(payload = expected.payload.reversed())
            assertEquals(OpenFailure.BadSignature, (crypto.openEnvelope(tampered, receiver, peer(sender)) as OpenResult.Failed).reason)
        }
    }

    @Test
    fun relayAuth() {
        val v = vectors.o("relayAuth")
        // The vector answers the challenge as the Mac; the bytes are the same for any device.
        val mac = device("mac")
        val nonce = BridgeCrypto.unb64(v.s("nonce"))!!
        assertEquals(v.s("signingBytes"), BridgeCrypto.relayAuthSigningBytes(nonce, mac.deviceId).toHex())
        assertEquals(v.s("signature"), b64(crypto.relayAuthSignature(nonce, mac)))
    }

    @Test
    fun pairRequestAcceptAndUnpair() {
        val mac = device("mac")
        val phone = device("phone")
        val pr = vectors.o("pairRequest")
        val frame = pr.o("frame")
        assertEquals(pr.s("additionalData"), BridgeCrypto.pairRequestAdditionalData(frame.s("from"), frame.s("to")).toHex())
        val sealed = crypto.sealPairRequest(
            pr.s("plaintext"), frame.s("from"), frame.s("to"), BridgeCrypto.unb64(pr.s("pairingSecret"))!!, pr.s("nonce").hexToBytes(),
        )
        assertEquals(frame.s("sealed"), sealed)

        val pa = vectors.o("pairAccept")
        assertEquals(
            pa.s("signingBytes"),
            BridgeCrypto.pairAcceptSigningBytes(mac.deviceId, phone.deviceId, phone.signingPublicKey, phone.kxPublicKey).toHex(),
        )
        val acceptSignature = BridgeCrypto.unb64(pa.o("accept").s("signature"))!!
        assertTrue(crypto.verifyPairAccept(acceptSignature, mac.deviceId, mac.signingPublicKey, phone))

        val u = vectors.o("unpair")
        val uf = u.o("frame")
        assertEquals(u.s("signingBytes"), BridgeCrypto.unpairSigningBytes(uf.s("id"), uf.s("from"), uf.s("to"), uf.s("at")).toHex())
        val signature = crypto.signUnpair(uf.s("id"), uf.s("from"), uf.s("to"), uf.s("at"), phone)
        assertEquals(uf.s("signature"), b64(signature))
        assertArrayEquals(signature, BridgeCrypto.unb64(uf.s("signature")))
    }
}
