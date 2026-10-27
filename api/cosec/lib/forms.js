// The Companies House forms the planner can send, and how each is written as XML for the Companies House XML Gateway.
//
// READ THIS BEFORE USING A FORM FOR REAL. The XML below follows the shape of the Companies House GovTalk messages, but the exact
// element names for each form come from Companies House's published schemas (http://xmlgw.companieshouse.gov.uk/SchemaStatus),
// which could not be read when this was written. They have to be checked against those schemas during testing with a Companies House test account. That is why:
//   * every form has `confirmed: false` until you have had it accepted by the Companies House TEST service, and
//   * the server will not send a form to the LIVE service unless its id is listed in the Azure setting CH_LIVE_FORMS.
// To change what is sent, this file is the only place to edit.

const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (name, v) => (String(v === undefined || v === null ? "" : v).trim() ? `<${name}>${esc(v)}</${name}>` : "");

function address(a) {
  return [tag("Premises", a.premises), tag("Street", a.line1), tag("Thoroughfare", a.line2), tag("PostTown", a.town), tag("County", a.county), tag("Country", a.country), tag("Postcode", a.postcode)].join("");
}

const FORMS = {
  AD01: {
    title: "Change of registered office address",
    // the GovTalk message class and the element that holds the form
    class: "ChangeOfRegisteredOffice",
    confirmed: false,
    check(payload) {
      const a = payload.address || {};
      const missing = [];
      if (!String(a.line1 || "").trim()) missing.push("first line");
      if (!String(a.town || "").trim()) missing.push("town");
      if (!String(a.postcode || "").trim()) missing.push("postcode");
      if (!String(a.country || "").trim()) missing.push("country");
      return missing.length ? `The new address is missing its ${missing.join(", ")}.` : "";
    },
    body(payload, company) {
      return `<ChangeOfRegisteredOffice xmlns="http://xmlgw.companieshouse.gov.uk">`
        + tag("CompanyNumber", company.number) + tag("CompanyName", company.name) + tag("CompanyAuthenticationCode", company.authCode)
        + `<NewAddress>${address(payload.address || {})}</NewAddress>`
        + `</ChangeOfRegisteredOffice>`;
    },
  },
};

module.exports = { FORMS, esc, tag };
