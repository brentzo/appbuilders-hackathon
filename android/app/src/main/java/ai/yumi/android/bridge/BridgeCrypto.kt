package ai.yumi.android.bridge

import com.goterl.lazysodium.LazySodium
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.time.Instant
import java.util.Base64
import yumi.protocol.Envelope
import yumi.protocol.EnvelopeType
import yumi.protocol.PROTOCOL_VERSION

/** This phone's own keys. The secret keys never leave the device and are never logged. */
class DeviceKeys(
    val deviceId: String,
    val signingPublicKey: ByteArray,
    /** libsodium's 64-byte Ed25519 secret key (seed and public key). */
    val signingSecretKey: ByteArray,
    val kxPublicKey: ByteArray,
    val kxSecretKey: ByteArray,
) {
    override fun toString() = "DeviceKeys($deviceId)"
}

/** What the phone stores about its paired Mac. */
class PeerKeys(val deviceId: String, val signingPublicKey: ByteArray, val kxPublicKey: ByteArray)

class SessionKeys(val rx: ByteArray, val tx: ByteArray)

/** Why an envelope did not open, in the order protocol/docs/crypto.md checks them. */
enum class OpenFailure { WrongRecipient, WrongSender, BadSignature, BadExpiry, CannotDecrypt, InvalidPayload }

sealed interface OpenResult {
    /** [plaintext] is the decrypted UTF-8 JSON object holding `payload` and, for a result, `replyTo`. */
    class Opened(val envelope: Envelope, val plaintext: String) : OpenResult

    /** Authentic but expired: never run it (SPEC-08 r6). */
    class Expired(val envelope: Envelope) : OpenResult
    class Failed(val reason: OpenFailure) : OpenResult
}

/**
 * The bridge crypto from protocol/docs/crypto.md, matching the reference `protocol/src/crypto.ts` byte for byte.
 * `BridgeCryptoVectorsTest` reproduces protocol/vectors/bridge-crypto-v2.json.
 *
 * Takes any [LazySodium], so the app uses lazysodium-android and the unit tests lazysodium-java.
 */
class BridgeCrypto(private val sodium: LazySodium) {

    fun randomBytes(count: Int): ByteArray = sodium.randomBytesBuf(count)

    fun keysFromSeeds(signingSeed: ByteArray, kxSeed: ByteArray): DeviceKeys {
        val signPk = ByteArray(32)
        val signSk = ByteArray(64)
        check(sodium.cryptoSignSeedKeypair(signPk, signSk, signingSeed)) { "Ed25519 key pair failed" }
        val kxPk = ByteArray(32)
        val kxSk = ByteArray(32)
        check(sodium.cryptoKxSeedKeypair(kxPk, kxSk, kxSeed)) { "X25519 key pair failed" }
        return DeviceKeys(deviceIdFor(signPk), signPk, signSk, kxPk, kxSk)
    }

    /** The lowercase hex of the 16-byte BLAKE2b hash of the signing public key. */
    fun deviceIdFor(signingPublicKey: ByteArray): String {
        val out = ByteArray(16)
        check(sodium.cryptoGenericHash(out, out.size, signingPublicKey, signingPublicKey.size.toLong(), null, 0))
        return out.toHex()
    }

    /** The device whose X25519 public key sorts first, as unsigned bytes from the first, is the client. */
    fun sessionKeys(me: DeviceKeys, peer: PeerKeys): SessionKeys {
        val order = compareUnsigned(me.kxPublicKey, peer.kxPublicKey)
        require(order != 0) { "A device cannot pair with itself" }
        val rx = ByteArray(32)
        val tx = ByteArray(32)
        val ok = if (order < 0) {
            sodium.cryptoKxClientSessionKeys(rx, tx, me.kxPublicKey, me.kxSecretKey, peer.kxPublicKey)
        } else {
            sodium.cryptoKxServerSessionKeys(rx, tx, me.kxPublicKey, me.kxSecretKey, peer.kxPublicKey)
        }
        check(ok) { "Session keys failed" }
        return SessionKeys(rx, tx)
    }

    fun sign(message: ByteArray, secretKey: ByteArray): ByteArray {
        val signature = ByteArray(64)
        check(sodium.cryptoSignDetached(signature, message, message.size.toLong(), secretKey))
        return signature
    }

    fun verify(signature: ByteArray, message: ByteArray, publicKey: ByteArray): Boolean =
        signature.size == 64 && publicKey.size == 32 &&
            sodium.cryptoSignVerifyDetached(signature, message, message.size, publicKey)

    /** Seals [plaintextJson] (the object with `payload` and, for a result, `replyTo`) for [recipient]. */
    fun sealEnvelope(
        sender: DeviceKeys,
        recipient: PeerKeys,
        type: EnvelopeType,
        expiresAt: String,
        plaintextJson: String,
        id: String,
        nonce: ByteArray = randomBytes(NONCE_BYTES),
    ): Envelope {
        val routing = Envelope(id, sender.deviceId, recipient.deviceId, type, expiresAt, PROTOCOL_VERSION, "", "")
        val payload = seal(plaintextJson.toByteArray(), envelopeAdditionalData(routing), nonce, sessionKeys(sender, recipient).tx)
        val signature = sign(envelopeSigningBytes(routing, payload), sender.signingSecretKey)
        return routing.copy(signature = b64(signature), payload = payload)
    }

    /** Checks and opens an envelope from [sender], in the order of protocol/docs/crypto.md. Never throws. */
    fun openEnvelope(envelope: Envelope, receiver: DeviceKeys, sender: PeerKeys, now: Instant = Instant.now()): OpenResult {
        if (envelope.to != receiver.deviceId) return OpenResult.Failed(OpenFailure.WrongRecipient)
        if (envelope.from != sender.deviceId) return OpenResult.Failed(OpenFailure.WrongSender)
        val signature = unb64(envelope.signature) ?: return OpenResult.Failed(OpenFailure.BadSignature)
        if (!verify(signature, envelopeSigningBytes(envelope, envelope.payload), sender.signingPublicKey)) {
            return OpenResult.Failed(OpenFailure.BadSignature)
        }
        val expiry = runCatching { Instant.parse(envelope.expiresAt) }.getOrNull()
            ?: return OpenResult.Failed(OpenFailure.BadExpiry)
        if (!now.isBefore(expiry)) return OpenResult.Expired(envelope)
        if (expiry.toEpochMilli() - now.toEpochMilli() > MAX_EXPIRY_AHEAD_MS) return OpenResult.Failed(OpenFailure.BadExpiry)
        if (compareUnsigned(receiver.kxPublicKey, sender.kxPublicKey) == 0) return OpenResult.Failed(OpenFailure.CannotDecrypt)
        val plain = open(envelope.payload, envelopeAdditionalData(envelope), sessionKeys(receiver, sender).rx)
            ?: return OpenResult.Failed(OpenFailure.CannotDecrypt)
        val text = runCatching {
            Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(plain)).toString()
        }.getOrNull() ?: return OpenResult.Failed(OpenFailure.InvalidPayload)
        return OpenResult.Opened(envelope, text)
    }

    fun relayAuthSignature(challenge: ByteArray, keys: DeviceKeys): ByteArray =
        sign(relayAuthSigningBytes(challenge, keys.deviceId), keys.signingSecretKey)

    /** Seals the phone's PairRequest JSON with the QR code's one-time secret. */
    fun sealPairRequest(requestJson: String, from: String, to: String, secret: ByteArray, nonce: ByteArray = randomBytes(NONCE_BYTES)): String =
        seal(requestJson.toByteArray(), canonical(PAIR_REQUEST_DOMAIN, from, to), nonce, secret)

    /** Checks the Mac's pairAccept signature with the Mac's key from the QR code. */
    fun verifyPairAccept(signature: ByteArray, mac: String, macSigningKey: ByteArray, phone: DeviceKeys): Boolean =
        verify(signature, pairAcceptSigningBytes(mac, phone.deviceId, phone.signingPublicKey, phone.kxPublicKey), macSigningKey)

    fun signUnpair(id: String, from: String, to: String, at: String, keys: DeviceKeys): ByteArray =
        sign(unpairSigningBytes(id, from, to, at), keys.signingSecretKey)

    fun verifyUnpair(signature: ByteArray, id: String, from: String, to: String, at: String, signingKey: ByteArray): Boolean =
        verify(signature, unpairSigningBytes(id, from, to, at), signingKey)

    /** XChaCha20-Poly1305 IETF; returns the ciphertext with its tag. */
    fun encrypt(plaintext: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray): ByteArray {
        val out = ByteArray(plaintext.size + TAG_BYTES)
        val length = LongArray(1)
        check(
            sodium.cryptoAeadXChaCha20Poly1305IetfEncrypt(
                out, length, plaintext, plaintext.size.toLong(), additionalData, additionalData.size.toLong(), null, nonce, key,
            ),
        )
        return out.copyOf(length[0].toInt())
    }

    fun decrypt(ciphertext: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray): ByteArray? {
        if (ciphertext.size < TAG_BYTES || nonce.size != NONCE_BYTES || key.size != 32) return null
        val out = ByteArray(ciphertext.size - TAG_BYTES)
        val length = LongArray(1)
        val ok = sodium.cryptoAeadXChaCha20Poly1305IetfDecrypt(
            out, length, null, ciphertext, ciphertext.size.toLong(), additionalData, additionalData.size.toLong(), nonce, key,
        )
        return if (ok) out.copyOf(length[0].toInt()) else null
    }

    private fun seal(plaintext: ByteArray, additionalData: ByteArray, nonce: ByteArray, key: ByteArray): String =
        b64(nonce + encrypt(plaintext, additionalData, nonce, key))

    private fun open(sealed: String, additionalData: ByteArray, key: ByteArray): ByteArray? {
        val bytes = unb64(sealed) ?: return null
        if (bytes.size < NONCE_BYTES) return null
        return decrypt(bytes.copyOfRange(NONCE_BYTES, bytes.size), additionalData, bytes.copyOfRange(0, NONCE_BYTES), key)
    }

    companion object {
        const val NONCE_BYTES = 24
        private const val TAG_BYTES = 16
        private const val ENVELOPE_DOMAIN = "yumi-envelope-v2"
        private const val RELAY_AUTH_DOMAIN = "yumi-relay-auth-v1"
        private const val PAIR_REQUEST_DOMAIN = "yumi-pair-request-v1"
        private const val PAIR_ACCEPT_DOMAIN = "yumi-pair-accept-v1"
        private const val UNPAIR_DOMAIN = "yumi-unpair-v1"

        /** The longest expiry (an approval request, 5 minutes) plus a minute for clocks that disagree. */
        private const val MAX_EXPIRY_AHEAD_MS = 6 * 60 * 1000L

        /** Each field as a 4-byte big-endian length and its bytes; text is UTF-8. */
        fun canonical(vararg fields: Any): ByteArray {
            val out = ByteArrayOutputStream()
            for (field in fields) {
                val bytes = when (field) {
                    is String -> field.toByteArray(Charsets.UTF_8)
                    is ByteArray -> field
                    else -> throw IllegalArgumentException("Canonical fields are text or bytes")
                }
                out.write(ByteBuffer.allocate(4).putInt(bytes.size).array())
                out.write(bytes)
            }
            return out.toByteArray()
        }

        private fun routing(e: Envelope): Array<Any> =
            arrayOf(ENVELOPE_DOMAIN, e.id, e.from, e.to, e.type.wire, e.expiresAt, e.protocolVersion.toString())

        fun envelopeAdditionalData(e: Envelope): ByteArray = canonical(*routing(e))
        fun envelopeSigningBytes(e: Envelope, payload: String): ByteArray = canonical(*routing(e), payload)
        fun relayAuthSigningBytes(challenge: ByteArray, deviceId: String) = canonical(RELAY_AUTH_DOMAIN, challenge, deviceId)
        fun pairRequestAdditionalData(from: String, to: String) = canonical(PAIR_REQUEST_DOMAIN, from, to)
        fun pairAcceptSigningBytes(from: String, to: String, signingPublicKey: ByteArray, kxPublicKey: ByteArray) =
            canonical(PAIR_ACCEPT_DOMAIN, from, to, signingPublicKey, kxPublicKey)
        fun unpairSigningBytes(id: String, from: String, to: String, at: String) = canonical(UNPAIR_DOMAIN, id, from, to, at)

        /** Standard base64 with padding (RFC 4648 section 4). */
        fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
        fun unb64(text: String): ByteArray? = runCatching { Base64.getDecoder().decode(text) }.getOrNull()

        private fun compareUnsigned(a: ByteArray, b: ByteArray): Int {
            for (i in 0 until minOf(a.size, b.size)) {
                val d = (a[i].toInt() and 0xff) - (b[i].toInt() and 0xff)
                if (d != 0) return d
            }
            return a.size - b.size
        }
    }
}

/** The envelope type as it appears on the wire and in the signed routing fields. */
val EnvelopeType.wire: String
    get() = when (this) {
        EnvelopeType.Command -> "command"
        EnvelopeType.Result -> "result"
        EnvelopeType.Event -> "event"
    }

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
fun String.hexToBytes(): ByteArray = chunked(2).map { it.toInt(16).toByte() }.toByteArray()
