package ai.yumi.android.bridge

import ai.yumi.android.bridge.BridgeCrypto.Companion.b64
import ai.yumi.android.bridge.BridgeCrypto.Companion.unb64
import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.protocol.ConnectionState
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import java.time.Instant
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import yumi.protocol.AckFrame
import yumi.protocol.AuthenticateFrame
import yumi.protocol.BridgeFrame
import yumi.protocol.ChallengeFrame
import yumi.protocol.DelegateGoalPayload
import yumi.protocol.DevicePlatform
import yumi.protocol.EnvelopeFrame
import yumi.protocol.EnvelopeType
import yumi.protocol.PROTOCOL_VERSION
import yumi.protocol.PairAccept
import yumi.protocol.PairAcceptFrame
import yumi.protocol.PairExpiredFrame
import yumi.protocol.PairRequest
import yumi.protocol.PairRequestFrame
import yumi.protocol.PairingOffer
import yumi.protocol.ReadyFrame
import yumi.protocol.TargetOfflineFrame
import yumi.protocol.UnpairFrame

/** RelayBridge against a scripted relay and Mac, with the real crypto (OBJ-23). */
class RelayBridgeTest {
    private val crypto = BridgeCrypto(LazySodiumJava(SodiumJava()))
    private val json = Json { explicitNulls = false; ignoreUnknownKeys = true }
    private val frames = serializer<BridgeFrame>()
    private val server = MockWebServer()
    private val toPhone = LinkedBlockingQueue<WebSocket>()
    private val fromPhone = LinkedBlockingQueue<String>()
    private val logs = mutableListOf<String>()

    private val mac = crypto.keysFromSeeds(crypto.randomBytes(32), crypto.randomBytes(32))
    private val phoneKeys = crypto.keysFromSeeds(crypto.randomBytes(32), crypto.randomBytes(32))
    private val secret = crypto.randomBytes(32)
    private val store = MemoryBridgeStore()
    private lateinit var bridge: RelayBridge
    private lateinit var relay: WebSocket

    @Before
    fun setUp() {
        repeat(4) {
            server.enqueue(
                MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) { toPhone.put(webSocket) }
                    override fun onMessage(webSocket: WebSocket, text: String) { fromPhone.put(text) }
                }),
            )
        }
        server.start()
        bridge = RelayBridge(
            crypto, { phoneKeys }, store, "Test phone", allowLoopback = true,
            log = { synchronized(logs) { logs += it } }, reconnectBaseMs = 50,
        )
    }

    @After
    fun tearDown() {
        bridge.close()
        server.shutdown()
    }

    private val url get() = "ws://127.0.0.1:${server.port}"

    private fun next(): BridgeFrame = json.decodeFromString(frames, fromPhone.poll(5, TimeUnit.SECONDS) ?: error("No frame from the phone"))
    private fun sendToPhone(frame: BridgeFrame) = relay.send(json.encodeToString(frames, frame))

    private fun offer(expiresAt: Instant = Instant.now().plusSeconds(300), version: Long = PROTOCOL_VERSION) = json.encodeToString(
        PairingOffer.serializer(),
        PairingOffer(version, mac.deviceId, "Brent's MacBook", DevicePlatform.Mac, b64(mac.signingPublicKey), b64(mac.kxPublicKey), b64(secret), url, expiresAt.toString()),
    )

    /** The relay's side of a connection: challenge, authenticate, ready. */
    private fun handshake() {
        relay = toPhone.poll(5, TimeUnit.SECONDS) ?: error("Phone never connected")
        val nonce = crypto.randomBytes(32)
        sendToPhone(ChallengeFrame(b64(nonce)))
        val auth = next() as AuthenticateFrame
        assertEquals(phoneKeys.deviceId, auth.deviceId)
        assertTrue(crypto.verify(unb64(auth.signature)!!, BridgeCrypto.relayAuthSigningBytes(nonce, phoneKeys.deviceId), phoneKeys.signingPublicKey))
        sendToPhone(ReadyFrame)
    }

    private fun pairNow() {
        bridge.start(CoroutineScope(Dispatchers.Unconfined))
        bridge.pair(offer())
        handshake()
        val request = next() as PairRequestFrame
        val opened = crypto.decrypt(
            unb64(request.sealed)!!.copyOfRange(24, unb64(request.sealed)!!.size),
            BridgeCrypto.pairRequestAdditionalData(request.from, request.to),
            unb64(request.sealed)!!.copyOfRange(0, 24),
            secret,
        )!!
        val pr = json.decodeFromString(PairRequest.serializer(), opened.decodeToString())
        assertEquals("Test phone", pr.deviceName)
        val signature = crypto.sign(
            BridgeCrypto.pairAcceptSigningBytes(mac.deviceId, phoneKeys.deviceId, phoneKeys.signingPublicKey, phoneKeys.kxPublicKey),
            mac.signingSecretKey,
        )
        sendToPhone(PairAcceptFrame(mac.deviceId, phoneKeys.deviceId, PairAccept(b64(signature))))
        runBlocking { withTimeout(5000) { bridge.pairing.first { it is PairingState.Paired } } }
    }

    private val phonePeer get() = PeerKeys(phoneKeys.deviceId, phoneKeys.signingPublicKey, phoneKeys.kxPublicKey)
    private val macPeer get() = PeerKeys(mac.deviceId, mac.signingPublicKey, mac.kxPublicKey)

    private fun macCommand(payloadJson: String, expiresAt: Instant = Instant.now().plusSeconds(120), from: DeviceKeys = mac): EnvelopeFrame =
        EnvelopeFrame(crypto.sealEnvelope(from, phonePeer, EnvelopeType.Command, expiresAt.toString(), """{"payload":$payloadJson}""", UUID.randomUUID().toString()))

    private fun openFromPhone(frame: EnvelopeFrame): String =
        (crypto.openEnvelope(frame.envelope, mac, phonePeer) as OpenResult.Opened).plaintext

    @Test
    fun pairThenPingRunsOnceAndRepeatsTheStoredResult() {
        pairNow()
        assertEquals(PairingState.Paired("Brent's MacBook"), bridge.pairing.value)
        assertEquals(ConnectionState.Connected, bridge.state.value)
        assertEquals(mac.deviceId, store.saved.peer?.deviceId)

        val ping = macCommand("""{"kind":"ping"}""")
        sendToPhone(ping)
        val result = next() as EnvelopeFrame
        assertEquals(AckFrame(ping.envelope.id), next())
        val body = json.parseToJsonElement(openFromPhone(result)).jsonObject
        assertEquals(ping.envelope.id, body["replyTo"]!!.jsonPrimitive.content)
        assertEquals("pingResult", body["payload"]!!.jsonObject["kind"]!!.jsonPrimitive.content)

        // Duplicate delivery runs once: the same result frame is sent again (SPEC-08 "Duplicate delivery runs once").
        sendToPhone(ping)
        assertEquals(result, next())
        assertEquals(AckFrame(ping.envelope.id), next())
    }

    @Test
    fun expiredCommandIsNotRun() {
        pairNow()
        val old = macCommand("""{"kind":"ping"}""", expiresAt = Instant.now().minusSeconds(1))
        sendToPhone(old)
        val reply = json.parseToJsonElement(openFromPhone(next() as EnvelopeFrame)).jsonObject
        assertEquals("commandExpired", reply["payload"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertEquals(AckFrame(old.envelope.id), next())
    }

    @Test
    fun messageFromAnUnknownDeviceIsDropped() {
        pairNow()
        val stranger = crypto.keysFromSeeds(crypto.randomBytes(32), crypto.randomBytes(32))
        sendToPhone(macCommand("""{"kind":"ping"}""", from = stranger))
        assertNull(fromPhone.poll(500, TimeUnit.MILLISECONDS))
        assertTrue(synchronized(logs) { logs.any { "unpaired device" in it } })
    }

    @Test
    fun delegatedGoalIsSealedForTheMacAndAFailedDeliveryHasAKind() {
        pairNow()
        val id = bridge.send(EnvelopeType.Command, DelegateGoalPayload(UUID.randomUUID().toString(), "export my Keynote deck as a PDF", phoneKeys.deviceId, Instant.now().toString()))!!
        val frame = next() as EnvelopeFrame
        assertEquals(id, frame.envelope.id)
        assertTrue("export my Keynote deck as a PDF" in openFromPhone(frame))
        val failure = runBlocking {
            val waiting = async(Dispatchers.Default) { withTimeout(5000) { bridge.failures.first() } }
            kotlinx.coroutines.delay(100)
            sendToPhone(TargetOfflineFrame(id, mac.deviceId))
            waiting.await()
        }
        assertEquals(MessageFailure(id, ErrorKind.OtherDeviceOffline), failure)
    }

    @Test
    fun unpairFromTheMacIsVerifiedAndAcknowledged() {
        pairNow()
        val unpairId = UUID.randomUUID().toString()
        val at = Instant.now().plusSeconds(1).toString()
        val sig = crypto.sign(BridgeCrypto.unpairSigningBytes(unpairId, mac.deviceId, phoneKeys.deviceId, at), mac.signingSecretKey)
        val frame = UnpairFrame(unpairId, mac.deviceId, phoneKeys.deviceId, at, b64(sig))
        sendToPhone(frame)
        assertEquals(AckFrame(unpairId), next())
        assertNull(store.saved.peer)
        assertEquals(null, bridge.pairedMac.value)
    }

    @Test
    fun expiredOfferSendsNothing() {
        bridge.start(CoroutineScope(Dispatchers.Unconfined))
        bridge.pair(offer(expiresAt = Instant.now().minusSeconds(1)))
        val state = runBlocking { withTimeout(5000) { bridge.pairing.first { it is PairingState.Failed } } }
        assertEquals(PairingState.Failed(ErrorKind.PairingCodeExpired), state)
        assertNull(toPhone.poll(300, TimeUnit.MILLISECONDS))
    }

    @Test
    fun otherVersionAndNonOfferAreNamed() {
        bridge.start(CoroutineScope(Dispatchers.Unconfined))
        bridge.pair(offer(version = 5))
        assertEquals(PairingState.Failed(ErrorKind.PairingVersionsDiffer), runBlocking { withTimeout(5000) { bridge.pairing.first { it is PairingState.Failed } } })
        bridge.pair("https://example.com")
        runBlocking { withTimeout(5000) { bridge.pairing.first { it == PairingState.Failed(ErrorKind.NotAPairingCode) } } }
    }

    @Test
    fun macDidNotAnswerOnPairExpired() {
        bridge.start(CoroutineScope(Dispatchers.Unconfined))
        bridge.pair(offer())
        handshake()
        next() as PairRequestFrame
        sendToPhone(PairExpiredFrame(mac.deviceId))
        assertEquals(PairingState.Failed(ErrorKind.MacDidntAnswerPairing), runBlocking { withTimeout(5000) { bridge.pairing.first { it is PairingState.Failed } } })
        assertNull(store.saved.peer)
    }

    @Test
    fun reconnectsAfterTheRelayDrops() {
        pairNow()
        relay.close(1001, "relay restarting")
        runBlocking { withTimeout(5000) { bridge.state.first { it == ConnectionState.Reconnecting } } }
        handshake()
        runBlocking { withTimeout(5000) { bridge.state.first { it == ConnectionState.Connected } } }
    }
}
