import ExpoModulesCore
import UIKit

public class TabSwipeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabSwipe")
    View(TabSwipeView.self) {
      Events("onTabSwipe")
      Prop("enabled") { (view: TabSwipeView, enabled: Bool) in
        view.enabled = enabled
      }
      Prop("backEdge") { (view: TabSwipeView, edge: Double) in
        view.backEdge = CGFloat(edge)
      }
    }
  }
}

/// A one-finger horizontal pan over a screen's tabs, reported to JavaScript.
///
/// It begins only outside every list row: a row keeps its own swipe actions.
/// A drag right that landed in the back edge band is the stack's back swipe.
/// A vertical or diagonal drag fails it at once, and the list scrolls.
internal final class TabSwipeView: ExpoView, UIGestureRecognizerDelegate {
  let onTabSwipe = EventDispatcher()
  /// Off cancels a pan in progress.
  var enabled = false {
    didSet { pan.isEnabled = enabled }
  }
  var backEdge: CGFloat = 0

  /// The same axis lock as the Pane Swipe: `HORIZONTAL_PAN_RATIO` in pan-axis.ts.
  private static let horizontalPanRatio: CGFloat = 1.5
  private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
  /// Where the finger landed. The pan's translation leaves out the travel
  /// before the pan began, so it cannot say this.
  private var landedInWindow = CGPoint.zero
  private var landed = CGPoint.zero

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    pan.maximumNumberOfTouches = 1
    pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    pan.delegate = self
    pan.isEnabled = false
    addGestureRecognizer(pan)
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === pan else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
    let velocity = pan.velocity(in: self)
    guard abs(velocity.x) > abs(velocity.y) * Self.horizontalPanRatio else { return false }
    if velocity.x > 0 && landedInWindow.x < backEdge { return false }
    return !isInListRow(hitTest(landed, with: nil))
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    landedInWindow = touch.location(in: nil)
    landed = touch.location(in: self)
    return true
  }

  /// The list waits for this pan to fail before it scrolls. It fails as soon
  /// as the finger leaves the tap slop on any other axis, so a scroll starts
  /// as quickly as before.
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    guard let scrollView = otherGestureRecognizer.view as? UIScrollView else { return false }
    return otherGestureRecognizer === scrollView.panGestureRecognizer
  }

  private func isInListRow(_ view: UIView?) -> Bool {
    var each = view
    while let current = each, current !== self {
      if current is UICollectionViewCell || current is UITableViewCell { return true }
      each = current.superview
    }
    return false
  }

  @objc private func handlePan() {
    switch pan.state {
    case .began: emit("began")
    case .changed: emit("changed")
    case .ended: emit("ended")
    case .cancelled, .failed: emit("cancelled")
    default: break
    }
  }

  private func emit(_ phase: String) {
    onTabSwipe([
      "phase": phase,
      "translation": pan.translation(in: self).x,
      "velocity": pan.velocity(in: self).x,
    ])
  }
}
