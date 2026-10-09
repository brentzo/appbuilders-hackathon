package ai.yumi.android.voice.wakeword

import android.content.Context
import android.content.res.AssetManager
import android.util.Log
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File

/**
 * Spots "Hey Yumi" with Vosk, an offline speech recognizer, limited by a grammar to that phrase plus an
 * unknown-word catch-all (SPEC-01 Decisions, OBJ-59). Anything else said decodes as `[unk]`, and sound-alikes such
 * as "hey you me" decode as "hey yumi", which is fine for the demo.
 *
 * Only finished utterances count: Vosk's in-progress guesses often read "hey yumi" for a moment for other phrases
 * such as "Hey Jarvis", then settle on `[unk]`. Each result is checked and dropped at once, never kept or logged.
 */
class VoskSpotter(private val recognizer: PhraseRecognizer) : WakeWordSpotter {

    override fun detect(chunk: ShortArray): Boolean {
        val result = recognizer.accept(chunk) ?: return false
        return heardWakePhrase(result)
    }

    override fun reset() = recognizer.reset()

    override fun clear() = recognizer.reset()

    /** The part of a recognizer this spotter needs, so tests can stand in for Vosk. */
    interface PhraseRecognizer {
        /** Feeds one chunk. Returns the result JSON when it ends an utterance, otherwise null. */
        fun accept(chunk: ShortArray): String?

        /** Forgets the utterance in progress. */
        fun reset()
    }

    private class VoskRecognizer(private val recognizer: Recognizer) : PhraseRecognizer {
        override fun accept(chunk: ShortArray): String? =
            if (recognizer.acceptWaveForm(chunk, chunk.size)) recognizer.result else null

        override fun reset() = recognizer.reset()
    }

    companion object {
        const val PHRASE = "hey yumi"
        const val MODEL_NAME = "vosk-model-small-en-us-0.15"

        /** Where the build puts the model in the app's assets (the `fetchVoskModel` task in `app/build.gradle.kts`). */
        const val ASSET_DIR = "vosk/$MODEL_NAME"

        /** Vosk's grammar format: a JSON list of phrases. `[unk]` takes every word that is not in a phrase. */
        const val GRAMMAR = "[\"$PHRASE\", \"[unk]\"]"

        private val TEXT = Regex("\"text\"\\s*:\\s*\"([^\"]*)\"")
        private val PHRASE_WORDS = PHRASE.split(' ')

        /** True if a Vosk result (`{"text" : "..."}`) has the phrase in it, for example "hey yumi" or "[unk] hey yumi [unk]". */
        fun heardWakePhrase(result: String): Boolean {
            val words = TEXT.find(result)?.groupValues?.get(1)?.split(' ')?.filter { it.isNotEmpty() } ?: return false
            return words.windowed(PHRASE_WORDS.size).any { it == PHRASE_WORDS }
        }

        /**
         * Loads the model and a grammar-limited recognizer, or returns null (and logs why) if it cannot.
         * Vosk reads the model from files, so the first start copies it out of the APK into the app's private storage.
         * Runs on the audio thread: the first copy takes a few seconds.
         */
        fun load(context: Context): VoskSpotter? = try {
            LibVosk.setLogLevel(LogLevel.WARNINGS)
            val dir = unpackModel(context)
            val recognizer = Recognizer(Model(dir.absolutePath), SAMPLE_RATE, GRAMMAR)
            // Ends an utterance after a shorter pause, so the listening sound follows "Hey Yumi" sooner.
            recognizer.setEndpointerMode(Recognizer.EndpointerMode.SHORT)
            VoskSpotter(VoskRecognizer(recognizer))
        } catch (e: Exception) {
            // The status line then never says it is listening, which is the truth. Nothing to show the user.
            Log.e(TAG, "Could not load the Vosk wake word model", e)
            null
        }

        private fun unpackModel(context: Context): File {
            val root = File(context.noBackupFilesDir, "vosk")
            val dir = File(root, MODEL_NAME)
            if (dir.isDirectory) return dir
            // Copy into a temporary folder and rename it at the end, so a copy cut short is never used.
            root.listFiles()?.forEach { it.deleteRecursively() }
            val partial = File(root, "$MODEL_NAME.partial")
            copyAssets(context.assets, ASSET_DIR, partial)
            check(partial.renameTo(dir)) { "Could not move the unpacked model into place" }
            Log.i(TAG, "Unpacked $MODEL_NAME")
            return dir
        }

        private fun copyAssets(assets: AssetManager, path: String, target: File) {
            val children = assets.list(path).orEmpty()
            if (children.isEmpty()) {
                target.parentFile?.mkdirs()
                assets.open(path).use { input -> target.outputStream().use { input.copyTo(it) } }
            } else {
                children.forEach { copyAssets(assets, "$path/$it", File(target, it)) }
            }
        }

        private val SAMPLE_RATE = AudioFeatures.SAMPLE_RATE.toFloat()
        private const val TAG = "YumiWakeWord"
    }
}
