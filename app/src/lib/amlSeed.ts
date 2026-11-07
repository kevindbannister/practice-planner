// Starting wording for the AML pack, taken from the firm's own draft documents. It is a first draft to be checked, completed and approved:
// nothing here counts as evidence that a control has been carried out. See amlPack.ts.
export const AML_SEED = {
 "fwra": {
  "control": {
   "Firm": "Insight Accounts Limited (ACCA firm ID 5492067)",
   "Trading name": "The Accurate Accountant",
   "AML supervisor": "ACCA",
   "Assessment owner": "Kevin Bannister (ACCA 1543478)",
   "Assessment date": "",
   "Approved by": "",
   "Next review": "",
   "Status": "Draft; portfolio and controls evidence still to be verified"
  },
  "purpose": [
   "This assessment identifies the firm’s exposure to money laundering, terrorist financing and proliferation financing (MLTF/PF), and sets proportionate controls. It follows the ACCA FWRA template areas: client, geography, products and services, transactions, delivery channels and proliferation financing. It is based on information supplied so far and must be checked against the client list, engagement records and actual procedures before approval.",
   "Known profile: one director and one person working in the practice; fewer than 50 clients; last-year revenue is reported as below £100,000; three clients are reported to each represent more than 15% of revenue. The firm provides bookkeeping, accounts, tax, payroll, company secretarial work and company formation. No registered office service is provided. The user reports no clients in the high-risk sector categories listed in the ACCA annual return. Counts and other risk facts remain to be reconciled to practice records."
  ],
  "risks": [
   {
    "area": "Client risk",
    "risk": "Provisional: Medium, subject to portfolio review. Small portfolio; client sectors in the ACCA high-risk list reported as none. Client identities, beneficial owners, PEP/sanctions results, overseas links, source of funds/wealth triggers, criminal history and client risk ratings have not yet been evidenced here. Revenue concentration in three clients increases dependency and change risk.",
    "controls": "Before acceptance, identify and verify client/entity and beneficial owners, understand purpose and expected activity, screen relevant parties, document a client-specific risk rating, and apply CDD/EDD proportionately. Reconcile the whole client list and flag concentration. Review when ownership, service, geography, activity or risk changes.",
    "verify": "Portfolio counts, CDD completion and screening method [verify]."
   },
   {
    "area": "Geography risk",
    "risk": "Provisional: Unassessed beyond the firm operating from the UK. Client residence, ownership, counterparties, suppliers, customers and transaction jurisdictions are not yet confirmed.",
    "controls": "Record countries linked to the client and its beneficial owners, business, funds, suppliers, customers and transactions. Check current HMT high-risk country notice, FATF lists and UK Sanctions List at onboarding and when risk changes. Apply EDD where required and record source/date/results.",
    "verify": "Client geography analysis and actual list checks [complete]."
   },
   {
    "area": "Products and services risk",
    "risk": "Inherent: Medium to High. Bookkeeping, accounts preparation and tax services can be used to create or legitimise records. Payroll creates exposure to employee/payee data and payment instructions. Company secretarial and company formation services create ownership/control and misuse risks. No registered office service.",
    "controls": "Engagement acceptance and client risk assessment before work. Verify ownership/PSC and purpose for company services. Reconcile records to source material, investigate unusual or unsupported entries, check payroll changes and payment instructions independently, and escalate unusual tax or company formation requests. Do not act as nominee or take control of client assets unless separately assessed and approved.",
    "verify": "Confirm company formation volumes, payroll payment role, client-money/assets handling, and actual quality checks."
   },
   {
    "area": "Transactions risk",
    "risk": "Provisional: Medium. Bookkeeping, payroll and company formation can involve high-volume records or changes to payees, ownership, bank details, or accounting entries. The firm’s role in initiating/authorising client payments is unconfirmed.",
    "controls": "Understand expected transaction profile and service boundaries. Escalate transactions without a clear economic/legal purpose, unusual complexity or size, unexplained cash, rapid changes, third-party payments, inconsistent records, or unusual payroll/ownership changes. Confirm whether any client money or assets are received, held, controlled or transmitted.",
    "verify": "Map payment instructions and client money/asset handling [confirm]."
   },
   {
    "area": "Delivery channel risk",
    "risk": "Provisional: Medium. Digital tools are used for some draft accounts preparation. The extent of remote onboarding, e-signatures, electronic ID checks, client portals, email and third-party software is not confirmed.",
    "controls": "Record delivery channels and any new technology or outsourced checks. For non-face-to-face onboarding, use reliable independent verification, verify control of contact details and resolve discrepancies before acceptance. Restrict access to client files and SAR records; review access and service-provider controls.",
    "verify": "List platforms, e-verification provider and remote onboarding process [complete]."
   },
   {
    "area": "Proliferation financing risk",
    "risk": "Provisional: Low to Medium. No client links to high-risk sectors were reported in the information supplied, but geography, goods, counterparties and ownership have not yet been reviewed for PF indicators.",
    "controls": "Screen geography, ownership, services and transactions for links to sanctioned persons, entities, jurisdictions, dual-use goods and opaque trade/payment structures. Keep the UK Sanctions List and current government/ACCA guidance under review. Escalate concerns to the MLRO and consider SAR and sanctions reporting duties.",
    "verify": "Complete client and service review for PF indicators; record date and sources."
   }
  ],
  "conclusion": "Overall inherent risk is assessed provisionally as MEDIUM, with higher-risk service exposure from company formation and payroll. Residual risk cannot be rated until the firm confirms the client portfolio, geographies, actual payment/asset handling, and whether the controls described here are operating. This is not evidence that controls have already been completed.",
  "actions": [
   [
    "Reconcile all client and service counts to practice records",
    "Kevin Bannister (ACCA 1543478)",
    "",
    "Dated client/service schedule"
   ],
   [
    "Confirm countries, ownership, PEP/sanctions and criminal-risk screening for each client",
    "Kevin Bannister (ACCA 1543478)",
    "",
    "Completed risk register and screening records"
   ],
   [
    "Confirm whether client money/assets or payment authority is involved, including payroll",
    "Kevin Bannister (ACCA 1543478)",
    "",
    "Written process map / client mandates"
   ],
   [
    "Complete and approve AML P&P; communicate and implement controls",
    "MLRO and director",
    "",
    "Approved P&P and implementation records"
   ],
   [
    "Arrange independent review by a person other than the MLRO",
    "Independent reviewer to be appointed",
    "",
    "Signed independent review report"
   ],
   [
    "Complete formal AML training and retain evidence",
    "MLRO",
    "",
    "Certificate and learning record"
   ]
  ],
  "approval": {
   "Prepared by": "Kevin Bannister (ACCA 1543478)",
   "Date": "",
   "Director approval": "",
   "Next review date": "",
   "Review trigger": "Annual review; also after material change in client profile, services, geography, delivery systems, law or guidance, control failure, or relevant intelligence"
  },
  "reference": "ACCA Firm-wide Risk Assessment template and factsheet (Nov 2026 template and May 2026 factsheet supplied); ACCA Identifying Client Risk factsheet (Apr 2026); CCAB Anti-Money Laundering Guidance for the Accountancy Sector, updated August 2026; Money Laundering Regulations 2017 as amended; current HMT high-risk third-country notice, FATF publications, UK Sanctions List and NCA guidance."
 },
 "policies": {
  "control": {
   "Firm / ACCA ID": "Insight Accounts Limited / 5492067",
   "Trading name": "The Accurate Accountant",
   "Supervisor": "ACCA",
   "MLRO": "Kevin Bannister, ACCA 1543478",
   "MLRO email": "kevin@theaccurateaccountant.co.uk",
   "MLRO telephone": "",
   "Version": "Draft 0.1",
   "Effective date": "",
   "Approved by": "",
   "Next review": ""
  },
  "sections": [
   {
    "title": "1. Purpose, scope and responsibilities",
    "text": "This policy sets the firm’s controls to prevent, identify and report money laundering, terrorist financing and proliferation financing. It applies to all services: bookkeeping, accounts, tax, payroll, company secretarial work and company formation. The firm has one director and one person working in the practice. The MLRO is Kevin Bannister. The MLRO is responsible for the firm-wide risk assessment, client risk methodology, CDD/EDD decisions, internal disclosures, external SAR decisions, training, records, monitoring and annual effectiveness reporting.\n\nIf a service, client, transaction or technology falls outside the assessed scope, pause acceptance or work that could facilitate the activity, assess the risk, update the FWRA and this policy, and document approval before proceeding. The firm will not provide a registered office address service. Any proposal to act as nominee, director, trustee, signatory, or to receive, hold, control or transmit client money/assets requires a prior documented risk assessment and management approval."
   },
   {
    "title": "2. Risk assessment and controls",
    "text": "The MLRO maintains a written FWRA covering clients, geography, products/services, transactions, delivery channels and proliferation financing. It is reviewed at least annually and when risks or the business change. The risk assessment informs this policy and each client’s risk rating. Changes, rationale, approval and review date are recorded. The working FWRA is a draft until the client portfolio and actual process facts have been reconciled and the director has approved it."
   },
   {
    "title": "3. Client acceptance and customer due diligence",
    "text": "Before establishing a business relationship or carrying out a relevant occasional transaction, the MLRO completes and records the onboarding and client risk form. Work must not commence until required CDD is completed or the MLRO has documented a lawful basis and controls for any permitted timing exception. If identity cannot be verified or required CDD cannot be completed, do not establish/continue the relationship; consider whether a SAR is required.\n\n- Identify the client and verify identity using reliable, independent documents/data. Record the source, date and result. For individuals, capture name, date of birth and residential address, and verify as appropriate.\n- For entities, confirm legal existence, registered details, business/activity, ownership and control; identify and verify beneficial owners and relevant persons acting on behalf of the client. Check Companies House and PSC data, investigate discrepancies, and retain evidence.\n- Understand the purpose and intended nature of the relationship, services requested, expected activity, source of funds/wealth where risk requires, and relevant countries/counterparties.\n- Screen the client, beneficial owners and relevant controllers against the UK Sanctions List and PEP/adverse-media sources using the firm’s selected method. Record tool/source, date, search terms, result and resolution. [Name tool/provider or manual source before adoption.]\n- Complete client risk classification and obtain MLRO approval. Record outstanding items, decision, reason and review date."
   },
   {
    "title": "4. Client risk ratings and enhanced due diligence",
    "text": "All clients are classified low, medium or high. Medium is the default where no low- or high-risk features are established. Low risk is exceptional and must be justified. High-risk indicators include PEP status, high-risk jurisdiction links, complex/opaque ownership, cash-intensive or high-value sectors, unusual non-face-to-face circumstances, unexplained activity, sanctions concerns, adverse media or other relevant risk factors. Company formation and payroll services are considered in the firm-wide assessment and may increase a client’s risk depending on the facts.\n\nFor high-risk clients, the MLRO documents specific EDD proportionate to the risk. This may include additional identity/ownership evidence, enhanced scrutiny of the purpose and expected activity, source of funds/wealth evidence, senior approval, more frequent monitoring and additional screening. A high rating alone is not a conclusion of wrongdoing. Do not lower a rating simply to accept a client.\n\nSimplified due diligence may only be used where the legal conditions are met and low risk is supported by a documented assessment. Record the rationale and retain sufficient information to understand the client and relationship."
   },
   {
    "title": "5. Service-specific procedures",
    "text": "- Bookkeeping and accounts: Understand the business and expected income/expense profile; retain source records; investigate unsupported, inconsistent, unusual or unexplained entries; do not knowingly create or endorse misleading records.\n- Tax work: Understand the commercial and factual basis of positions; challenge inconsistent information; document advice and client explanations; escalate suspected evasion or proceeds-of-crime concerns.\n- Payroll: Verify employer and authorised contacts; verify changes to employee identity, bank/payee details and payment instructions using a second channel; investigate unusual changes or third-party requests. Confirm whether the firm ever initiates, holds or controls payroll funds before adopting this procedure.\n- Company secretarial: Verify authority and purpose for filings and changes; review changes to directors, shareholders, PSCs and registered details; investigate unusual or opaque ownership changes.\n- Company formation: Complete CDD on the instructing party and intended owners/controllers before formation; understand purpose, ownership and intended activity; screen relevant persons and jurisdictions; document the decision and post-formation monitoring. Do not form structures designed to obscure ownership or facilitate wrongdoing."
   },
   {
    "title": "6. Ongoing monitoring and review",
    "text": "The MLRO schedules and records ongoing reviews. Initial proposed interval: high risk every six months; medium risk annually; low risk every two years. Confirm these intervals are workable and consistent with the client profile before approval. Review sooner when ownership, control, service, geography, expected activity, source of funds, sanctions/PEP status or other material facts change; when unusual activity occurs; or when information becomes inconsistent. Record a review even when no change is found."
   },
   {
    "title": "7. Sanctions screening and escalation",
    "text": "Screen clients, beneficial owners and relevant controllers at onboarding and during ongoing review, and check current UK sanctions information when a relevant change or alert arises. The UK Sanctions List is the UK source for designations. Investigate possible matches before acting; do not treat a name-only match as confirmed. Escalate potential matches immediately to the MLRO, pause affected services or transactions where legally required, preserve records, and obtain specialist advice where needed. Consider applicable reporting obligations to OFSI and the supervisor. Record the search and decision."
   },
   {
    "title": "8. Internal disclosures and external SARs",
    "text": "Anyone working for the firm must immediately tell the MLRO if they know, suspect or have reasonable grounds to know or suspect that money laundering or terrorist financing may be involved. Use the confidential Internal SAR Form in the AML Forms Pack. Because Kevin is currently the sole practitioner and MLRO, he must document his own suspicions and decision directly in the restricted MLRO SAR decision record; there is no separate internal reporting line. If the MLRO has a conflict or is unavailable, seek advice from ACCA or an appropriate independent legal adviser and use the applicable statutory reporting route.\n\nThe MLRO records the information considered, decision, rationale, date and any further action. Where required, submit an external SAR through the NCA SAR Portal and retain the acknowledgement/reference securely. Consider a Defence Against Money Laundering (DAML) request before proceeding with a prohibited act. Do not proceed with relevant activity until the applicable statutory notice/moratorium requirements are satisfied. A SAR is confidential; do not disclose its existence or content to the client or any unauthorised person. Avoid tipping off or prejudicing an investigation. Maintain a restricted SAR register separate from general client records."
   },
   {
    "title": "9. Training and awareness",
    "text": "The MLRO completes formal AML training at least once every two years, with annual refreshers and updates when law, guidance, services or risks change. Training covers ML/TF/PF risks, the firm’s FWRA and policy, CDD/EDD, client risk, red flags relevant to bookkeeping/accounts/tax/payroll/company services, sanctions, internal escalation, SAR confidentiality and tipping off. Keep course materials, provider, date, certificate, assessment/result and any follow-up. New employees or subcontractors must be trained before undertaking relevant work and periodically thereafter. The firm currently reports one person working in it; training evidence remains to be supplied."
   },
   {
    "title": "10. Records and confidentiality",
    "text": "Keep CDD and transaction records for the period required by the MLR, generally five years after the end of the business relationship or completion of the relevant occasional transaction, subject to applicable exceptions and legal holds. At the end of the period, securely delete or destroy records unless another legal/regulatory basis requires retention. Record retention dates and deletion decisions. Keep AML records retrievable and access-controlled. SARs, DAML material and related analysis are held in a restricted location with access limited to the MLRO and persons who need access."
   },
   {
    "title": "11. Compliance monitoring and independent review",
    "text": "The MLRO conducts a documented annual effectiveness review, including a sample of client files, risk ratings, screening, monitoring, training and record keeping. Findings and actions are recorded. The firm must also arrange an independent assessment by a competent person who is not the MLRO. As the firm currently has one person, a separate independent reviewer must be appointed; the MLRO cannot complete the independent review of their own controls. Track actions to closure and retain the report."
   },
   {
    "title": "12. Breaches and policy review",
    "text": "Record control failures, missed CDD, potential sanctions matches, unusual activity, data-access incidents and training gaps. The MLRO assesses immediate containment, client impact, reporting obligations, root cause and remedial action. Review this policy annually and on trigger events. Record each review, changes, approval and how the policy was communicated. For the current one-person practice, record the MLRO/director acknowledgement and implementation date."
   }
  ],
  "changelog": [
   [
    "Draft 0.1",
    "Initial firm-specific draft; completion and implementation outstanding",
    "Kevin Bannister (ACCA 1543478)",
    ""
   ],
   [
    "",
    "",
    "Kevin Bannister (ACCA 1543478)",
    ""
   ]
  ],
  "reference": "ACCA AML Procedures Guidance Document (Apr 2026, supplied); ACCA AML and client risk factsheets (Apr/May/Nov 2026, supplied); CCAB Anti-Money Laundering Guidance for the Accountancy Sector (updated August 2026); MLR 2017 as amended; POCA 2002; Terrorism Act 2000; NCA SAR Portal and UKFIU guidance; current UK Sanctions List and OFSI guidance."
 }
} as const;
