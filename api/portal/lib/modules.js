// Feature modules (documents, signing, identity, messages...) register their routes here as they
// are added. Each gets the same bound store and the same permission checks.
function modules(/* parts, ctx */) {
  return { portal: {}, adminGet: {}, adminPost: {} };
}
module.exports = { modules };
