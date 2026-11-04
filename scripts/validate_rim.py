#!/usr/bin/env python3
"""Check a GovTalk message against HMRC's official RIM artefacts: the XSD, then the HMRC schematron (as compiled XSLT).
Usage: validate_rim.py <rim-folder> <message.xml>   Prints problems; exit 0 = none, 1 = problems, 2 = tooling missing."""
import sys, os
try:
    from lxml import etree
except ImportError:
    print("lxml is not installed"); sys.exit(2)
folder, doc = sys.argv[1], sys.argv[2]
xsd = next(f for f in os.listdir(folder) if f.endswith(".xsd") and not f.startswith("envelope"))
xslt = next(f for f in os.listdir(folder) if f.endswith(".xslt"))
tree = etree.parse(doc)
problems = []
MTRNS = "{http://www.govtalk.gov.uk/taxation/SA/SA100/25-26/1}"
env = tree.getroot().find(".//" + MTRNS + "IRenvelope")
if env is None:
    print("No IRenvelope in the message"); sys.exit(1)
schema = etree.XMLSchema(etree.parse(os.path.join(folder, xsd)))
if not schema.validate(etree.ElementTree(env)):
    problems += [f"XSD line {e.line}: {e.message}" for e in schema.error_log]
else:
    out = etree.XSLT(etree.parse(os.path.join(folder, xslt)))(tree)
    ns = {"e": "http://www.govtalk.gov.uk/CM/errorresponse"}
    # HMRC's compiled rules answer with an ErrorResponse listing each business-rule failure (not SVRL); no e:Error = passed.
    for f in out.xpath("//e:Error", namespaces=ns):
        g = lambda n: " ".join("".join(f.xpath("e:" + n + "//text()", namespaces=ns)).split())
        problems.append(f"Rule {g('Number')} ({g('Type')}) at {g('Location')}: {g('Text')}")
for p in problems: print(p)
sys.exit(1 if problems else 0)
