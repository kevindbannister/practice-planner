// The client risk assessment questions for individuals and companies, taken from the accountants' templates supplied by the practice
// (questions, help text, conditions that show a question, and the rules that say a rating MUST or SHOULD be high). Generated; edit with care.
import { Template } from "./amlTemplate";

export const INDIVIDUAL: Template = {
 "id": "individual",
 "title": "Risk assessment - Accountants - Individuals",
 "sections": [
  {
   "title": "Identify and verify the identity of the client",
   "questions": [
    {
     "k": "i1",
     "t": "one",
     "label": "How was the client introduced?",
     "options": [
      "Referral by existing client",
      "Website lead",
      "Cold lead",
      "Networking",
      "Other"
     ],
     "help": "Introductions that are \"warmer\", e.g. by referral or networking, normally have less risk than totally \"cold\" connections where you have no connection to their network.",
     "need": true
    },
    {
     "k": "i2",
     "t": "one",
     "label": "Has an identity document been collected, verified and stored for this client?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "i3",
     "t": "one",
     "label": "Has the client passed AML identity verification checks?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "An AML check references the individuals' name and address to public registers like the electoral role to verify their identity and address. Some individuals may not have the relevant public records in place, may not have a credit history or have recently moved address. This may result in a REFER result on an electronic AML check and additional checks such as obtaining a proof of address should be completed.",
     "need": true
    },
    {
     "k": "i4",
     "t": "one",
     "label": "Has the client been identified as a PEP?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "A politically exposed person is more at risk of bribery and corruption due to their ability to influence policy and the spending of public funds. If a contact is identified as a PEP then the client should be classified as high risk and enhanced due diligence (EDD) completed to satisfy your AML / KYC responsibilities.",
     "need": true
    },
    {
     "k": "i5",
     "t": "one",
     "label": "Has the client been identified as being on the sanctions database?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "If the client is on the sanctions database then you should not engage with the client. Any such trade may result in criminal proceeds and as a result in a money laundering offence.",
     "need": true
    },
    {
     "k": "i6",
     "t": "risk",
     "label": "Overall client identity risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Consider all the questions and answers in this section carefully before allocating a Client Risk level to this client.",
     "need": true,
     "cat": "CLIENT_RISK"
    }
   ]
  },
  {
   "title": "Understanding the client and their activities",
   "questions": [
    {
     "k": "i7",
     "t": "one",
     "label": "Is the client a high net worth individual?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "A high-net-worth individual is generally considered to be somebody with at least £1 million in liquid financial assets.",
     "need": true
    },
    {
     "k": "i8",
     "t": "one",
     "label": "Does the client trade in high value items such as art, real estate, gold, yachts etc?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Criminals will often transfer criminal proceeds through the purchasing and selling of high value goods. It disguises the origin of the proceeds and these types of transactions might be more at risk of criminal activity.",
     "need": true
    },
    {
     "k": "i9",
     "t": "one",
     "label": "Does the client receive much of their income in cash?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "i10",
     "t": "one",
     "label": "Does the client generate income within any sectors that our firm is not familiar with?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Compare these with your policies and procedures. Income generated within sectors your firm is not familiar with might pose a higher risk.",
     "need": true
    },
    {
     "k": "i11",
     "t": "one",
     "label": "Does the client generate income within any higher risk sectors, such as crypto currency trading?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "i12",
     "t": "risk",
     "label": "Overall transactional risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Reviewing this section, what is the transactional risk associated with this client?",
     "need": true,
     "cat": "TRANSACTIONS_RISK"
    }
   ]
  },
  {
   "title": "Geographical risk",
   "questions": [
    {
     "k": "i13",
     "t": "one",
     "label": "Does the client have activities that fall outside your normal jurisdiction?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Any activities which take place outside of a jurisdiction you would consider as normal might pose a higher risk. It will be easier for you to identify suspicious activity within a jurisdiction you are used to operating within.",
     "need": true
    },
    {
     "k": "i14",
     "t": "one",
     "label": "Does your client have operations or transact with clients who have operations within high risk locations?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Activities within third countries are more at risk of money laundering. An up to date list of countries at higher risk of money laundering can be found on the FATF's website here: https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html (countries listed as \"under increased monitoring\" and \"high-risk jurisdictions\" should be considered).",
     "need": true
    },
    {
     "k": "i15",
     "t": "risk",
     "label": "Overall geographical risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Reviewing this section, what is the geographical risk associated with this client?",
     "need": true,
     "cat": "GEOGRAPHICAL_RISK"
    }
   ]
  },
  {
   "title": "Your services to the client",
   "questions": [
    {
     "k": "i16",
     "t": "many",
     "label": "Which of the following services does our firm offer to the client?",
     "options": [
      "Self assessment",
      "Tax advice",
      "Client money account",
      "Other"
     ],
     "need": true
    },
    {
     "k": "i17",
     "t": "one",
     "label": "Does the client subscribe to any services we offer that are deemed to be high risk?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Some services you offer may be deemed higher risk than others. For example, money launderers might use a client money account offered by an accountant to disguise the origin of funds by making it pass through the account of a trusted organisation. Services you do not offer regularly and are not considered normal for your firm might also pose a higher risk.",
     "need": true
    },
    {
     "k": "i18",
     "t": "risk",
     "label": "Overall products and services risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Reviewing this section, what is the products and services risk associated with this client?",
     "need": true,
     "cat": "PRODUCTS_AND_SERVICES_RISK"
    }
   ]
  },
  {
   "title": "Delivery channels",
   "questions": [
    {
     "k": "i19",
     "t": "one",
     "label": "Which methods of communication apply to this client?",
     "options": [
      "Face to face",
      "Remote",
      "Intermediary",
      "Other"
     ],
     "help": "Criminals may use intermediaries to disguise their true identity and distance themselves from criminal activity. Delivery channel risk could be increased where services/products are provided to clients who have not been met face-to-face, or where a business relationship with a client is conducted through an intermediary.",
     "need": true
    },
    {
     "k": "i20",
     "t": "risk",
     "label": "Overall delivery channel risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Enter the risk you associate with this section.",
     "need": true,
     "cat": "DELIVERY_CHANNELS_RISK"
    }
   ]
  },
  {
   "title": "Enhanced due diligence",
   "questions": [
    {
     "k": "i21",
     "t": "one",
     "label": "In review of all the factors, is there a need for enhanced due diligence (EDD)?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Generally if you have identified a high risk area within this questionnaire, enhanced due diligence would apply.",
     "need": true
    },
    {
     "k": "i22",
     "t": "long",
     "label": "Record steps taken to satisfy yourself for enhanced due diligence (EDD)",
     "help": "EDD is dependent on the area of risk and the holistic view of the client. Refer to your policies and procedures for guidance and note down any steps taken as part of the enhanced due diligence process. EDD can include actions such as checks on the client’s source of funds/source of wealth, additional verification checks on the company or beneficial owners and can also include mitigating actions to protect the firm from any money laundering offence.",
     "need": true,
     "hidden": true
    }
   ]
  }
 ],
 "conditions": [
  {
   "target": "i22",
   "source": "i21",
   "value": "Yes"
  }
 ],
 "rules": [
  {
   "when": [
    {
     "src": "i1",
     "op": "ne",
     "value": "Referral by existing client"
    },
    {
     "src": "i1",
     "op": "ne",
     "value": "Networking"
    }
   ],
   "then": {
    "src": "i6",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "i4",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i6",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i5",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i6",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i6",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "i21",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i7",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i12",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "i8",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i12",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "i9",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i12",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "i10",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i12",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i11",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i12",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i12",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "i21",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i13",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i15",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "i14",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i15",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i15",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "i21",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i17",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "i18",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i18",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "i21",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "i19",
     "op": "ne",
     "value": "Face to face"
    }
   ],
   "then": {
    "src": "i20",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "i20",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "i21",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  }
 ]
};

export const COMPANY: Template = {
 "id": "company",
 "title": "Risk assessment - Accountants - Company",
 "sections": [
  {
   "title": "Identify and verify the identity of the client",
   "questions": [
    {
     "k": "c1",
     "t": "one",
     "label": "Is the client trading name different to the registered name?",
     "options": [
      "Yes",
      "No",
      "N/A"
     ],
     "need": true
    },
    {
     "k": "c2",
     "t": "text",
     "label": "What is the trading name for the client?",
     "need": true,
     "hidden": true
    },
    {
     "k": "c3",
     "t": "one",
     "label": "Is the company registered with Companies House?",
     "options": [
      "Yes",
      "No",
      "N/A e.g. sole trader"
     ],
     "need": true
    },
    {
     "k": "c4",
     "t": "one",
     "label": "Does the client qualify as low risk and therefore simplified due diligence (SDD) applies?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Note that SDD and low risk would normally only apply to publicly owned enterprises or financial institutions regulated by the FCA. Customer due diligence (CDD) measures are still required but the extent and timing may be adjusted to reflect the assessment of low risk. Follow the guidance as set out within your policies & procedures in dealing with low risk clients.",
     "need": true
    },
    {
     "k": "c5",
     "t": "one",
     "label": "Is the client registered with any other organisation, such as the Charity Commission, Gambling Commission etc?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "c6",
     "t": "text",
     "label": "Which organisation is the client registered with?",
     "need": true,
     "hidden": true
    },
    {
     "k": "c7",
     "t": "text",
     "label": "If known, what is the registration number?",
     "need": false,
     "hidden": true
    },
    {
     "k": "c8",
     "t": "one",
     "label": "How was the client introduced?",
     "options": [
      "Referral by existing client",
      "Website lead",
      "Cold lead",
      "Networking",
      "Other"
     ],
     "help": "Introductions that are \"warmer\", e.g. by referral or networking, normally have less risk than totally \"cold\" connections where you have no connection to their network.",
     "need": true
    },
    {
     "k": "c9",
     "t": "one",
     "label": "Are you confident that the key contact you are dealing with is connected with the client and authorised to act on their behalf?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "c10",
     "t": "one",
     "label": "Is it easy to determine what the purpose of the business is?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "c11",
     "t": "one",
     "label": "Does the client have adverse media?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "By doing a Google search you can investigate whether a client has previously been in the press for the wrong reasons. If so and depending on the media, you may want to consider the client within a higher risk category. You may also want to protect your firm from potential reputational damage by not engaging with the client.",
     "need": true
    },
    {
     "k": "c12",
     "t": "date",
     "label": "When did the client start trading, or do they plan to start trading?",
     "need": true
    },
    {
     "k": "c13",
     "t": "one",
     "label": "Are all filings with HMRC and Companies House up to date for this client?",
     "options": [
      "Yes",
      "No",
      "N/A"
     ],
     "need": true
    },
    {
     "k": "c14",
     "t": "one",
     "label": "Does the information provided by the client regarding ownership agree with the details held on Companies House?",
     "options": [
      "Yes",
      "No",
      "N/A e.g. sole trader"
     ],
     "need": true
    },
    {
     "k": "c15",
     "t": "one",
     "label": "Have you reported the discrepancy to Companies House?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "It is a legal requirement to report any discrepancy on the PSC register, which you are aware of, to Companies House.",
     "need": true,
     "hidden": true
    },
    {
     "k": "c16",
     "t": "one",
     "label": "Have the beneficial owners been identified and added as contacts?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "c17",
     "t": "one",
     "label": "Have identity documents been collected, verified and stored for each beneficial owner?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "c18",
     "t": "one",
     "label": "Have all beneficial owners passed the AML identity verification?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "An AML check references the individuals' name and address to public registers like the electoral role to verify their identity and address. Some individuals may not have the relevant public records in place, may not have a credit history or have recently moved address. This may result in a REFER result on an electronic AML check and additional checks such as obtaining a proof of address should be completed.",
     "need": true
    },
    {
     "k": "c19",
     "t": "one",
     "label": "PEP screening result. Are any of the beneficial owners politically exposed?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "A politically exposed person is more at risk of bribery and corruption due to their ability to influence policy and the spending of public funds. If a contact is identified as a PEP then the client should be classified as high risk and enhanced due diligence (EDD) completed to satisfy your AML / KYC responsibilities.",
     "need": true
    },
    {
     "k": "c20",
     "t": "one",
     "label": "Sanctions screening result. Are any of the beneficial owners on the Sanctions database?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "If any of the beneficial owners are on the sanctions database then you should not engage with the client. Any such trade may result in criminal proceeds, and as a result, a money laundering offence.",
     "need": true
    },
    {
     "k": "c21",
     "t": "risk",
     "label": "Overall client identity risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Consider all the questions and answers in this section carefully before allocating a Client Risk level to this client.",
     "need": true,
     "cat": "CLIENT_RISK"
    }
   ]
  },
  {
   "title": "Understanding the client and their activities",
   "questions": [
    {
     "k": "c22",
     "t": "one",
     "label": "Does it make sense that this client is engaging with our firm?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Is the size of the client's business proportionate to our firm? Is the client’s business within our firm's areas of expertise?",
     "need": true
    },
    {
     "k": "c23",
     "t": "one",
     "label": "Has the client been evasive or uncooperative e.g. appeared reluctant to provide ID?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Reluctance to cooperate with the AML procedure might indicate a higher risk client as they may prefer to hide their true identity.",
     "need": true
    },
    {
     "k": "c24",
     "t": "one",
     "label": "Does the client operate within any sectors that our firm is not familiar with?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Compare these to your policies & procedures for defined sectors and services you consider to be normal. Offering services outside of sectors you consider to be normal for your practice may increase the level of risk associated with the client.",
     "need": true
    },
    {
     "k": "c25",
     "t": "one",
     "label": "Does the client operate within any higher risk sectors, such as cryptocurrencies and assets?",
     "options": [
      "Yes",
      "No"
     ],
     "need": true
    },
    {
     "k": "c26",
     "t": "one",
     "label": "Are there high volumes of cash transactions taking place within the business?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "High volumes of cash transactions which amount to a high total value may indicate a higher risk of money laundering. Businesses typically associated with money laundering such as hairdressers, nail bars or tanning salons are typically cash based businesses.",
     "need": true
    },
    {
     "k": "c27",
     "t": "one",
     "label": "Does the client have an unusually high number of bank accounts?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Criminals may try to disguise the origin of criminal proceeds by moving it through multiple bank accounts. It may also be that they move money through different bank accounts so as not to trigger suspicious activity reports by the financial institution by means of too much activity within one account.",
     "need": true
    },
    {
     "k": "c28",
     "t": "one",
     "label": "Does the client trade in high value items such as art, real estate, gold, yachts etc?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Criminals will often transfer criminal proceeds through the purchasing and selling of high value goods. It disguises the origin of the proceeds and these types of transactions might be more at risk of criminal activity.",
     "need": true
    },
    {
     "k": "c29",
     "t": "risk",
     "label": "Overall transactional risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Reviewing this section, what is the transactional risk associated with this client?",
     "need": true,
     "cat": "TRANSACTIONS_RISK"
    }
   ]
  },
  {
   "title": "Geographical risk",
   "questions": [
    {
     "k": "c30",
     "t": "one",
     "label": "Does the client have activities that fall outside your normal jurisdiction?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Any activities which take place outside of a jurisdiction you would consider as normal might pose a higher risk. It will be easier for you to identify suspicious activity within a jurisdiction you are used to operating within.",
     "need": true
    },
    {
     "k": "c31",
     "t": "one",
     "label": "Does your client have operations or transact with clients who have operations within high risk locations?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Activities within third countries are more at risk of money laundering. An up to date list of countries at higher risk of money laundering can be found on the FATF's website here: https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html (countries listed as \"under increased monitoring\" and \"high-risk jurisdictions\" should be considered).",
     "need": true
    },
    {
     "k": "c32",
     "t": "risk",
     "label": "Overall geographical risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Reviewing this section, what is the geographical risk associated with this client?",
     "need": true,
     "cat": "GEOGRAPHICAL_RISK"
    }
   ]
  },
  {
   "title": "Your services to the client",
   "questions": [
    {
     "k": "c33",
     "t": "many",
     "label": "Which of the following services does our firm offer to the client?",
     "options": [
      "Accounts",
      "Tax advice",
      "Company secretarial",
      "Payroll",
      "Client money account",
      "Other"
     ],
     "need": true
    },
    {
     "k": "c34",
     "t": "one",
     "label": "Does the client subscribe to any services we offer that are deemed to be high risk?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Some services you offer may be deemed higher risk than others. For example, money launderers might use a client money account offered by an accountant to disguise the origin of funds by making it pass through the account of a trusted organisation. Services you do not offer regularly and are not considered normal for your firm might also pose a higher risk.",
     "need": true
    },
    {
     "k": "c35",
     "t": "risk",
     "label": "Overall products and services risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Reviewing this section, what is the products and services risk associated with this client?",
     "need": true,
     "cat": "PRODUCTS_AND_SERVICES_RISK"
    }
   ]
  },
  {
   "title": "Delivery channels",
   "questions": [
    {
     "k": "c36",
     "t": "one",
     "label": "Which methods of communication apply to this client?",
     "options": [
      "Face to face with owner",
      "Remote, with owner",
      "Intermediary only",
      "Intermediary with occasional contact with owner",
      "Other"
     ],
     "help": "Criminals may use intermediaries to disguise their true identity and distance themselves from criminal activity. Delivery channel risk could be increased where services/products are provided to clients who have not been met face-to-face, or where a business relationship with a client is conducted through an intermediary.",
     "need": true
    },
    {
     "k": "c37",
     "t": "risk",
     "label": "Overall delivery channel risk?",
     "options": [
      "Low",
      "Normal",
      "High"
     ],
     "help": "Enter the risk you associate with this section.",
     "need": true,
     "cat": "DELIVERY_CHANNELS_RISK"
    }
   ]
  },
  {
   "title": "Enhanced due diligence",
   "questions": [
    {
     "k": "c38",
     "t": "one",
     "label": "In review of all the factors, is there a need for enhanced due diligence (EDD)?",
     "options": [
      "Yes",
      "No"
     ],
     "help": "Generally if you have identified a high risk area within this questionnaire, enhanced due diligence would apply.",
     "need": true
    },
    {
     "k": "c39",
     "t": "long",
     "label": "Record steps taken to satisfy yourself for enhanced due diligence (EDD)",
     "help": "EDD is dependent on the area of risk and the holistic view of the client. Refer to your policies and procedures for guidance and note down any steps taken as part of the enhanced due diligence process. EDD can include actions such as checks on the client’s source of funds/source of wealth, additional verification checks on the company or beneficial owners and can also include mitigating actions to protect the firm from any money laundering offence.",
     "need": true,
     "hidden": true
    }
   ]
  }
 ],
 "conditions": [
  {
   "target": "c2",
   "source": "c1",
   "value": "Yes"
  },
  {
   "target": "c6",
   "source": "c5",
   "value": "Yes"
  },
  {
   "target": "c7",
   "source": "c5",
   "value": "Yes"
  },
  {
   "target": "c15",
   "source": "c14",
   "value": "No"
  },
  {
   "target": "c39",
   "source": "c38",
   "value": "Yes"
  }
 ],
 "rules": [
  {
   "when": [
    {
     "src": "c4",
     "op": "eq",
     "value": "No"
    }
   ],
   "then": {
    "src": "c21",
    "op": "ne",
    "value": "Low"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c8",
     "op": "ne",
     "value": "Referral by existing client"
    },
    {
     "src": "c8",
     "op": "ne",
     "value": "Networking"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c9",
     "op": "eq",
     "value": "No"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c10",
     "op": "eq",
     "value": "No"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c11",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c13",
     "op": "eq",
     "value": "No"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c19",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c20",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c21",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c21",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "c38",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c22",
     "op": "eq",
     "value": "No"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c23",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c24",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c25",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c26",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c27",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c28",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c29",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c30",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c32",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c31",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c32",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c32",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "c38",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c29",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "c38",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c34",
     "op": "eq",
     "value": "Yes"
    }
   ],
   "then": {
    "src": "c35",
    "op": "eq",
    "value": "High"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c35",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "c38",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  },
  {
   "when": [
    {
     "src": "c36",
     "op": "ne",
     "value": "Face to face with owner"
    }
   ],
   "then": {
    "src": "c37",
    "op": "eq",
    "value": "High"
   },
   "strict": "SHOULD"
  },
  {
   "when": [
    {
     "src": "c37",
     "op": "eq",
     "value": "High"
    }
   ],
   "then": {
    "src": "c38",
    "op": "eq",
    "value": "Yes"
   },
   "strict": "MUST"
  }
 ]
};
