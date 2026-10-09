package ai.yumi.android.routing

import ai.yumi.android.bridge.BridgeCrypto
import ai.yumi.android.bridge.BridgeCrypto.Companion.b64
import ai.yumi.android.bridge.BridgeCrypto.Companion.unb64
import ai.yumi.android.bridge.MemoryBridgeStore
import ai.yumi.android.bridge.OpenResult
import ai.yumi.android.bridge.PairingState
import ai.yumi.android.bridge.PeerKeys
import ai.yumi.android.bridge.RelayBridge
import ai.yumi.android.voice.Speaker
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import java.time.Instant
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
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
import yumi.protocol.AuthenticateFrame
import yumi.protocol.BridgeFrame
import yumi.protocol.ChallengeFrame
import yumi.protocol.DevicePlatform
import yumi.protocol.EnvelopeFrame
import yumi.protocol.EnvelopeType
import yumi.protocol.GoalFinalStatus
import yumi.protocol.PROTOCOL_VERSION
import yumi.protocol.PairAccept
import yumi.protocol.PairAcceptFrame
import yumi.protocol.PairRequestFrame
import yumi.protocol.PairingOffer
import yumi.protocol.ReadyFrame

/**
 * GoalRouter against a scripted Mac over the real bridge and crypto (OBJ-67, OBJ-69).
 * The stand-in is the MockWebServer relay, as in [ai.yumi.android.bridge.RelayBridgeTest].
 */
class GoalRouterTest {
    private val crypto = BridgeCrypto(LazySodiumJava(SodiumJava()))
    private val json = Json { explicitNulls = false; ignoreUnknownKeys = true }
    private val frames = serializer<BridgeFrame>()
    private val server = MockWebServer()
    private val toPhone = LinkedBlockingQueue<WebSocket>()
    private val fromPhone = LinkedBlockingQueue<String>()

    private val mac = crypto.keysFromSeeds(crypto.randomBytes(32), crypto.randomBytes(32))
    private val phoneKeys = crypto.keysFromSeeds(crypto.randomBytes(32), crypto.randomBytes(32))
    private val secret = crypto.randomBytes(32)
    private val store = MemoryBridgeStore()
    private lateinit var bridge: RelayBridge
    private lateinit var relay: WebSocket
    private lateinit var router: GoalRouter
    private val spoken = mutableListOf<String>()
    private val scope = CoroutineScope(Dispatchers.Unconfined)

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
            log = {}, reconnectBaseMs = 50,
        )
        router = GoalRouter(bridge, Speaker { spoken += it }, scope)
    }

    @After
    fun tearDown() {
        bridge.close()
        server.shutdown()
    }

    private val url get() = "ws://127.0.0.1:${server.port}"

    private fun next(): BridgeFrame = json.decodeFromString(frames, fromPhone.poll(5, TimeUnit.SECONDS) ?: error("No frame from the phone"))
    private fun sendToPhone(frame: BridgeFrame) = relay.send(json.encodeToString(frames, frame))

    /** The next envelope the phone sent, skipping the acks of the events fed to it. */
    private fun nextEnvelope(): EnvelopeFrame {
        while (true) {
            val frame = next()
            if (frame is EnvelopeFrame) return frame
        }
    }

    private fun offer(expiresAt: Instant = Instant.now().plusSeconds(300)) = json.encodeToString(
        PairingOffer.serializer(),
        PairingOffer(
            PROTOCOL_VERSION, mac.deviceId, "Brent's MacBook", DevicePlatform.Mac,
            b64(mac.signingPublicKey), b64(mac.kxPublicKey), b64(secret), url, expiresAt.toString(),
        ),
    )

    /** The relay's side of a connection: challenge, authenticate, ready. */
    private fun handshake() {
        relay = toPhone.poll(5, TimeUnit.SECONDS) ?: error("Phone never connected")
        val nonce = crypto.randomBytes(32)
        sendToPhone(ChallengeFrame(b64(nonce)))
        val auth = next() as AuthenticateFrame
        assertTrue(crypto.verify(unb64(auth.signature)!!, BridgeCrypto.relayAuthSigningBytes(nonce, phoneKeys.deviceId), phoneKeys.signingPublicKey))
        sendToPhone(ReadyFrame)
    }

    private fun pairNow() {
        bridge.start(scope)
        bridge.pair(offer())
        handshake()
        next() as PairRequestFrame
        val signature = crypto.sign(
            BridgeCrypto.pairAcceptSigningBytes(mac.deviceId, phoneKeys.deviceId, phoneKeys.signingPublicKey, phoneKeys.kxPublicKey),
            mac.signingSecretKey,
        )
        sendToPhone(PairAcceptFrame(mac.deviceId, phoneKeys.deviceId, PairAccept(b64(signature))))
        runBlocking { withTimeout(5_000) { bridge.pairing.first { it is PairingState.Paired } } }
    }

    private val phonePeer get() = PeerKeys(phoneKeys.deviceId, phoneKeys.signingPublicKey, phoneKeys.kxPublicKey)

    private fun awaitState(predicate: (GoalFlow) -> Boolean): GoalFlow =
        runBlocking { withTimeout(5_000) { router.state.first(predicate) } }

    private fun openPayload(frame: EnvelopeFrame): JsonObject =
        json.parseToJsonElement((crypto.openEnvelope(frame.envelope, mac, phonePeer) as OpenResult.Opened).plaintext)
            .jsonObject.getValue("payload").jsonObject

    private fun sendEvent(payloadJson: String) {
        val envelope = crypto.sealEnvelope(
            mac, phonePeer, EnvelopeType.Event, Instant.now().plusSeconds(120).toString(),
            """{"payload":$payloadJson}""", UUID.randomUUID().toString(),
        )
        sendToPhone(EnvelopeFrame(envelope))
    }

    private fun progress(goalId: String, status: String, title: String) =
        sendEvent("""{"kind":"progress","goalId":"$goalId","status":"$status","currentSubtaskTitle":"$title","updatedAt":"${Instant.now()}"}""")

    /** Repeat a goal back and confirm it, returning the goal id the phone chose. */
    private fun confirmGoal(goal: String): String {
        router.onGoal(goal)
        val confirming = awaitState { it is GoalFlow.Confirming } as GoalFlow.Confirming
        router.confirm(confirming.goal)
        val payload = openPayload(nextEnvelope())
        assertEquals("delegateGoal", payload["kind"]!!.jsonPrimitive.content)
        return payload["goalId"]!!.jsonPrimitive.content
    }

    @Test
    fun `a delegated goal is repeated back and sent only after confirm`() {
        pairNow()
        router.onGoal("export my Keynote deck as a PDF")
        val confirming = awaitState { it is GoalFlow.Confirming } as GoalFlow.Confirming

        // SPEC-10 r8: the fixed delegated template, spoken.
        assertEquals("You said: \"export my Keynote deck as a PDF\". Should I send it to your Mac?", confirming.prompt)
        assertEquals(listOf(confirming.prompt), spoken)

        // Nothing is sent to the Mac before the user confirms.
        assertNull(fromPhone.poll(300, TimeUnit.MILLISECONDS))

        router.confirm(confirming.goal)
        val payload = openPayload(nextEnvelope())
        assertEquals("delegateGoal", payload["kind"]!!.jsonPrimitive.content)
        assertEquals("export my Keynote deck as a PDF", payload["confirmedGoal"]!!.jsonPrimitive.content)
        assertEquals(phoneKeys.deviceId, payload["originDeviceId"]!!.jsonPrimitive.content)
        assertTrue(awaitState { it is GoalFlow.Working } is GoalFlow.Working)
    }

    @Test
    fun `the edited transcript is what is delegated`() {
        pairNow()
        router.onGoal("export my Keynote deck as a PDF")
        awaitState { it is GoalFlow.Confirming }
        router.confirm("export my Keynote deck as images")
        assertEquals("export my Keynote deck as images", openPayload(nextEnvelope())["confirmedGoal"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a yes reply confirms the goal`() {
        pairNow()
        router.onGoal("export my Keynote deck as a PDF")
        awaitState { it is GoalFlow.Confirming }
        router.onGoal("go ahead")
        assertEquals("delegateGoal", openPayload(nextEnvelope())["kind"]!!.jsonPrimitive.content)
        assertTrue(awaitState { it is GoalFlow.Working } is GoalFlow.Working)
    }

    @Test
    fun `a reply that is not yes or no is a corrected goal`() {
        pairNow()
        router.onGoal("export my Keynote deck as a PDF")
        awaitState { it is GoalFlow.Confirming }
        router.onGoal("actually export it as images")
        val confirming = awaitState { it is GoalFlow.Confirming } as GoalFlow.Confirming
        assertEquals("actually export it as images", confirming.goal)
        assertEquals("You said: \"actually export it as images\". Should I send it to your Mac?", confirming.prompt)
    }

    @Test
    fun `a cancel reply to the repeat-back sends nothing`() {
        pairNow()
        router.onGoal("export my Keynote deck as a PDF")
        awaitState { it is GoalFlow.Confirming }
        router.onGoal("no")
        assertEquals(GoalFlow.Idle, awaitState { it is GoalFlow.Idle })
        assertNull(fromPhone.poll(300, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `progress updates the subtask and goalFinished speaks the summary`() {
        pairNow()
        val goalId = confirmGoal("export my Keynote deck as a PDF")
        progress(goalId, status = "running", title = "Opening Keynote")
        val working = awaitState { it is GoalFlow.Working && it.subtask == "Opening Keynote" } as GoalFlow.Working
        assertEquals("export my Keynote deck as a PDF", working.goal)

        sendEvent("""{"kind":"goalFinished","goalId":"$goalId","status":"done","summary":"Done. Your deck is exported as a PDF on your Mac."}""")
        val finished = awaitState { it is GoalFlow.Finished } as GoalFlow.Finished
        assertEquals(GoalFinalStatus.Done, finished.status)
        assertEquals("Done. Your deck is exported as a PDF on your Mac.", finished.summary)
        assertTrue(spoken.contains("Done. Your deck is exported as a PDF on your Mac."))
    }

    @Test
    fun `stop shows paused only after the Mac confirms`() {
        pairNow()
        val goalId = confirmGoal("export my Keynote deck as a PDF")

        router.stop()
        val pause = openPayload(nextEnvelope())
        assertEquals("pause", pause["kind"]!!.jsonPrimitive.content)
        assertEquals(goalId, pause["goalId"]!!.jsonPrimitive.content)
        assertTrue(awaitState { it is GoalFlow.Pausing } is GoalFlow.Pausing)

        // A progress that says paused is not enough: the phone shows Paused only after pauseConfirmed (SPEC-09 r12).
        progress(goalId, status = "paused", title = "Exporting the deck")
        assertTrue(router.state.value is GoalFlow.Pausing)

        sendEvent("""{"kind":"pauseConfirmed","goalId":"$goalId"}""")
        assertTrue(awaitState { it is GoalFlow.Paused } is GoalFlow.Paused)
    }

    @Test
    fun `resume restarts and cancel waits for the Mac`() {
        pairNow()
        val goalId = confirmGoal("export my Keynote deck as a PDF")

        router.stop()
        openPayload(nextEnvelope())
        awaitState { it is GoalFlow.Pausing }
        sendEvent("""{"kind":"pauseConfirmed","goalId":"$goalId"}""")
        awaitState { it is GoalFlow.Paused }

        router.resume()
        assertEquals("resume", openPayload(nextEnvelope())["kind"]!!.jsonPrimitive.content)
        assertTrue(awaitState { it is GoalFlow.Working } is GoalFlow.Working)

        router.stop()
        openPayload(nextEnvelope())
        awaitState { it is GoalFlow.Pausing }
        sendEvent("""{"kind":"pauseConfirmed","goalId":"$goalId"}""")
        awaitState { it is GoalFlow.Paused }

        router.cancel()
        assertEquals("cancel", openPayload(nextEnvelope())["kind"]!!.jsonPrimitive.content)
        // Still paused until the Mac confirms the cancel.
        assertTrue(router.state.value is GoalFlow.Paused)
        sendEvent("""{"kind":"cancelConfirmed","goalId":"$goalId"}""")
        assertEquals(GoalFlow.Idle, awaitState { it is GoalFlow.Idle })
    }
}
