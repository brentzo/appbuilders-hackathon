/// PLACEHOLDER: whether the local model server is ready.
///
/// Always `unknown` for now. The protocol has no way for the harness to report model readiness,
/// and no repo file says how the model server is started. Waiting on Jepoy (protocol) and Brent
/// (harness); the proposal is a harness event plus a field in `hello`'s result. When it lands,
/// add the states here and make `AppModel.status` show "getting ready" while the model loads.
enum ModelReadiness: Sendable {
    case unknown
}
