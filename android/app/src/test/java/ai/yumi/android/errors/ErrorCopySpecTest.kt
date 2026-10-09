package ai.yumi.android.errors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** SPEC-11 scenario "Copy table matches the code": every row in the spec table has the same text and buttons in code. */
class ErrorCopySpecTest {

    private data class SpecRow(val failure: String, val text: String, val buttons: List<String>)

    private val rows: List<SpecRow> by lazy {
        val specsDir = System.getProperty("yumi.specsDir") ?: error("yumi.specsDir is not set; run the tests through Gradle")
        val lines = File(specsDir, "11-user-facing-errors.md").readLines()
        val start = lines.indexOfFirst { it.startsWith("| Failure |") }
        check(start >= 0) { "Error copy table not found in SPEC-11" }
        lines.drop(start + 2)
            .takeWhile { it.startsWith("|") }
            .map { line ->
                val cells = line.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }
                SpecRow(
                    failure = cells[0],
                    text = cells[1].removeSurrounding("\""),
                    buttons = cells[2].split(",").map { it.trim() },
                )
            }
    }

    @Test
    fun everySpecRowMatchesTheCode() {
        for (row in rows) {
            val kind = ErrorKind.entries.firstOrNull { it.specName == row.failure }
                ?: throw AssertionError("SPEC-11 row \"${row.failure}\" has no ErrorKind")
            val copy = ErrorCopyTable.of(kind)
            assertEquals("Text for \"${row.failure}\"", row.text, copy.text)
            assertEquals("Buttons for \"${row.failure}\"", row.buttons, copy.buttons.map { it.label })
        }
    }

    @Test
    fun everyKindIsInTheSpec() {
        val specFailures = rows.map { it.failure }.toSet()
        for (kind in ErrorKind.entries) {
            assertTrue("${kind.name} (\"${kind.specName}\") is not a SPEC-11 row", kind.specName in specFailures)
        }
        assertEquals(ErrorKind.entries.size, rows.size)
    }
}
