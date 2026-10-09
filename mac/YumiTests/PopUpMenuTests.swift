import CoreGraphics
import Testing
import YumiProtocol
@testable import Yumi

/// An opened pop-up's menu is read so the next step can click an item, and `setValue` can choose
/// an item by title. On 2026-10-10 clicking "Where:" in Keynote's export panel twice did nothing the
/// model could see, and the PDF went to Documents.
@MainActor
struct PopUpMenuTests {
    typealias Node = GuiExecutionTests.FixtureNode
    let reads = Node.Reads()

    /// A save panel sheet with a "Where:" pop-up and an Export button. Open, the pop-up has a menu
    /// child whose items are on screen; closed it has no children, as real pop-ups do (checked on
    /// Xcode's and Preview's, 2026-10-10).
    func savePanel(open: Bool) -> Node {
        let items = ["Documents", "Desktop", "Downloads", "", "Other…"].enumerated().map { index, title in
            Node("AXMenuItem", title: title.isEmpty ? nil : title, frame: CGRect(x: 300, y: 200 + index * 22, width: 180, height: 22), reads: reads)
        }
        let menu = Node("AXMenu", frame: CGRect(x: 300, y: 200, width: 180, height: 110), reads: reads, children: items)
        let whereButton = Node(
            "AXPopUpButton", title: "Where:", frame: CGRect(x: 300, y: 150, width: 180, height: 24),
            value: .text("Documents"), reads: reads, children: open ? [menu] : []
        )
        let export = Node("AXButton", title: "Export", frame: CGRect(x: 500, y: 400, width: 80, height: 24), reads: reads)
        let group = Node("AXGroup", frame: CGRect(x: 200, y: 100, width: 500, height: 350), reads: reads, children: [whereButton, export])
        let sheet = Node("AXSheet", frame: CGRect(x: 200, y: 100, width: 500, height: 350), reads: reads, children: [group])
        return Node("AXWindow", frame: CGRect(x: 0, y: 0, width: 1200, height: 800), reads: reads, children: [sheet])
    }

    @Test func aClosedPopUpHasNoOpenMenu() {
        var trimmer = TreeTrimmer<Node>()
        trimmer.walk(savePanel(open: false), path: ElementPath.windowRoot, clip: nil)
        #expect(trimmer.openMenu == nil)
        #expect(trimmer.kept.map(\.label) == ["Where:", "Export"])
    }

    @Test func anOpenedPopUpsItemsAreReadWithPathsThatResolve() throws {
        let window = savePanel(open: true)
        var trimmer = TreeTrimmer<Node>()
        trimmer.walk(window, path: ElementPath.windowRoot, clip: nil)
        let open = try #require(trimmer.openMenu)
        #expect(open.owner?.info().title == "Where:")
        #expect(open.path == "AXWindow/AXSheet[0]/AXGroup[0]/AXPopUpButton[0]/AXMenu[0]")

        // What WindowReader lists as the menu layer: the items, separators dropped.
        var items = TreeTrimmer<Node>()
        WindowReader.walkItems(of: open.menu, path: open.path, into: &items)
        #expect(items.kept.map(\.label) == ["Documents", "Desktop", "Downloads", "Other…"])
        #expect(items.kept.allSatisfy { $0.role == .menuItem })
        let downloads = try #require(items.kept.first { $0.label == "Downloads" })
        #expect(downloads.path == "AXWindow/AXSheet[0]/AXGroup[0]/AXPopUpButton[0]/AXMenu[0]/AXMenuItem[2]")
        // The next step's click finds the same item again from the window.
        let (root, steps) = try #require(ElementPath.parse(downloads.path))
        #expect(root == ElementPath.windowRoot)
        #expect(ElementPath.resolve(steps, from: window)?.info().title == "Downloads")
    }

    @Test func aMenuWhoseItemsAreOffScreenIsNotOpen() {
        let hidden = Node("AXMenu", reads: reads, children: [Node("AXMenuItem", title: "Desktop", frame: .zero, reads: reads)])
        let popUp = Node("AXPopUpButton", title: "Where:", reads: reads, children: [hidden])
        #expect(PopUpMenus.openMenu(of: popUp, path: "AXWindow/AXPopUpButton[0]") == nil)
    }

    @Test func aMenuHangingOffTheAppIsFoundWithAPathFromTheApp() throws {
        let item = Node("AXMenuItem", title: "Desktop", frame: CGRect(x: 10, y: 10, width: 100, height: 20), reads: reads)
        let window = Node("AXWindow", reads: reads)
        let app = Node("AXApplication", reads: reads, children: [window, Node("AXMenu", reads: reads, children: [item])])
        let open = try #require(PopUpMenus.appMenu(of: app))
        #expect(open.owner == nil)
        #expect(open.path == "AXApplication/AXMenu[0]")
        let (root, steps) = try #require(ElementPath.parse(open.path + "/AXMenuItem[0]"))
        #expect(root == ElementPath.appRoot)
        #expect(ElementPath.resolve(steps, from: app)?.info().title == "Desktop")
        #expect(PopUpMenus.appMenu(of: Node("AXApplication", reads: reads, children: [window])) == nil)
    }

    @Test func setValueChoosesAnItemByTitle() throws {
        let window = savePanel(open: true)
        var trimmer = TreeTrimmer<Node>()
        trimmer.walk(window, path: ElementPath.windowRoot, clip: nil)
        let menu = try #require(trimmer.openMenu?.menu)
        #expect(PopUpMenus.item(titled: "Downloads", in: menu)?.info().title == "Downloads")
        #expect(PopUpMenus.item(titled: "  downloads ", in: menu)?.info().title == "Downloads", "case and spaces")
        #expect(PopUpMenus.item(titled: "Other", in: menu)?.info().title == "Other…", "the ellipsis")
        #expect(PopUpMenus.item(titled: "Desk", in: menu)?.info().title == "Desktop", "a prefix")
        #expect(PopUpMenus.item(titled: "Pictures", in: menu) == nil)
        #expect(PopUpMenus.notFound("Pictures", in: menu, owner: "the popUpButton \"Where:\"")
            == "There is no item \"Pictures\" in the popUpButton \"Where:\". Its items are \"Documents\", \"Desktop\", \"Downloads\", \"Other…\".")
    }

    @Test func aDisabledItemIsNeverChosen() {
        let item = Node("AXMenuItem", title: "Desktop", enabled: false, reads: reads)
        let menu = Node("AXMenu", reads: reads, children: [item])
        #expect(PopUpMenus.item(titled: "Desktop", in: menu) == nil)
    }
}
