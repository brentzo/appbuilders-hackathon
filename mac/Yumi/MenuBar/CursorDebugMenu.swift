import SwiftUI
import YumiProtocol

/// Debug aid: triggers each cursor command by hand (OBJ-18.7). Shown while the mock harness is
/// in use, next to "Send sample goal to the mock".
struct CursorDebugMenu: View {
    let actions: CursorDebugActions

    var body: some View {
        Menu("Cursor debug") {
            Button("Spawn main cursor") { actions.spawnMain() }
            Button("Spawn ghost cursor") { actions.spawnGhost() }
            Button("Move all cursors") { actions.moveAll() }
            Button("Move main to next display") { actions.moveMainToNextDisplay() }
            Button("Three cursors moving at once") { actions.threeAtOnce() }
            Menu("Set state") {
                ForEach(CursorState.allCases, id: \.self) { state in
                    Button(state.rawValue) { actions.setState(state) }
                }
            }
            Button("Set main label") { actions.setLabel() }
            Button("Show or hide a helper chip") { actions.toggleHelperChip() }
            Divider()
            Button("Fade all cursors") { actions.fadeAll() }
        }
    }
}
