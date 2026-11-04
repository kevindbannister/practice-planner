<?xml version="1.0" encoding="UTF-8"?>
<axsl:stylesheet xmlns:axsl="http://www.w3.org/1999/XSL/Transform" xmlns:dsig="http://www.w3.org/2000/09/xmldsig#" xmlns:hd="http://www.govtalk.gov.uk/CM/envelope" xmlns:ptr="http://www.govtalk.gov.uk/taxation/SA/SA800/25-26/1" xmlns:date="http://exslt.org/dates-and-times" xmlns:dyn="http://exslt.org/dynamic" xmlns:exsl="http://exslt.org/common" xmlns:iso="http://purl.oclc.org/dsdl/schematron" xmlns:math="http://exslt.org/math" xmlns:random="http://exslt.org/random" xmlns:regexp="http://exslt.org/regular-expressions" xmlns:sch="http://www.ascc.net/xml/schematron" xmlns:set="http://exslt.org/sets" xmlns:str="http://exslt.org/strings" dsig:dummy-for-xmlns="" exclude-result-prefixes="sch iso" extension-element-prefixes="date dyn math random regexp set str exsl" hd:dummy-for-xmlns="" ptr:dummy-for-xmlns="" version="1.0">

<!--PHASES-->


<!--PROLOG-->
<dsl-rim:namespaceMappings xmlns:dsl-rim="http://www.decisionsoft.com/rim" xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse">
    <dsl-rim:namespaceMapping prefix="hd" uri="http://www.govtalk.gov.uk/CM/envelope"/>
    <dsl-rim:namespaceMapping prefix="dsig" uri="http://www.w3.org/2000/09/xmldsig#"/>
    <dsl-rim:namespaceMapping prefix="ptr" uri="http://www.govtalk.gov.uk/taxation/SA/SA800/25-26/1"/>
  </dsl-rim:namespaceMappings>
  <axsl:output xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" indent="yes" method="xml" omit-xml-declaration="no" standalone="yes"/>

<!--KEYS-->


<!--DEFAULT RULES-->


<!--MODE: SCHEMATRON-FULL-PATH-->
<axsl:template match="*" mode="schematron-get-full-path">
    <axsl:apply-templates mode="schematron-get-full-path" select="parent::*"/>
    <axsl:text>/</axsl:text>
    <axsl:variable name="nsuri" select="namespace-uri()"/>
    <axsl:variable xmlns:dsl-rim="http://www.decisionsoft.com/rim" name="prefix" select="document('')//dsl-rim:namespaceMapping[@uri=$nsuri]/@prefix"/>
    <axsl:if test="$prefix">
      <axsl:value-of select="concat($prefix,':')"/>
    </axsl:if>
    <axsl:value-of select="local-name()"/>
    <axsl:variable name="preceding" select="count(preceding-sibling::*[local-name()=local-name(current())                                   and namespace-uri() = namespace-uri(current())])"/>
    <axsl:text>[</axsl:text>
    <axsl:value-of select="1+ $preceding"/>
    <axsl:text>]</axsl:text>
  </axsl:template>
  <axsl:template match="@*" mode="schematron-get-full-path">
    <axsl:apply-templates mode="schematron-get-full-path" select="parent::*"/>
    <axsl:text>/@</axsl:text>
    <axsl:variable name="nsuri" select="namespace-uri()"/>
    <axsl:variable xmlns:dsl-rim="http://www.decisionsoft.com/rim" name="prefix" select="document('')//dsl-rim:namespaceMapping[@uri=$nsuri]/@prefix"/>
    <axsl:if test="$prefix">
      <axsl:value-of select="concat($prefix,':')"/>
    </axsl:if>
    <axsl:value-of select="local-name()"/>
  </axsl:template>
  <!--Strip characters-->
  <axsl:template match="text()" priority="-1"/>

<!--SCHEMA METADATA-->
<axsl:template match="/">
    <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errors">
      <axsl:apply-templates mode="M4" select="/"/>
      <axsl:apply-templates mode="M5" select="/"/>
      <axsl:apply-templates mode="M6" select="/"/>
      <axsl:apply-templates mode="M7" select="/"/>
      <axsl:apply-templates mode="M8" select="/"/>
      <axsl:apply-templates mode="M9" select="/"/>
      <axsl:apply-templates mode="M10" select="/"/>
      <axsl:apply-templates mode="M11" select="/"/>
      <axsl:apply-templates mode="M12" select="/"/>
      <axsl:apply-templates mode="M13" select="/"/>
      <axsl:apply-templates mode="M14" select="/"/>
      <axsl:apply-templates mode="M15" select="/"/>
      <axsl:apply-templates mode="M16" select="/"/>
      <axsl:apply-templates mode="M17" select="/"/>
      <axsl:apply-templates mode="M18" select="/"/>
      <axsl:apply-templates mode="M19" select="/"/>
      <axsl:apply-templates mode="M20" select="/"/>
      <axsl:apply-templates mode="M21" select="/"/>
      <axsl:apply-templates mode="M22" select="/"/>
      <axsl:apply-templates mode="M23" select="/"/>
      <axsl:apply-templates mode="M24" select="/"/>
      <axsl:apply-templates mode="M25" select="/"/>
      <axsl:apply-templates mode="M26" select="/"/>
      <axsl:apply-templates mode="M27" select="/"/>
      <axsl:apply-templates mode="M28" select="/"/>
      <axsl:apply-templates mode="M29" select="/"/>
      <axsl:apply-templates mode="M30" select="/"/>
      <axsl:apply-templates mode="M31" select="/"/>
      <axsl:apply-templates mode="M32" select="/"/>
      <axsl:apply-templates mode="M33" select="/"/>
      <axsl:apply-templates mode="M34" select="/"/>
      <axsl:apply-templates mode="M35" select="/"/>
      <axsl:apply-templates mode="M36" select="/"/>
      <axsl:apply-templates mode="M37" select="/"/>
      <axsl:apply-templates mode="M38" select="/"/>
      <axsl:apply-templates mode="M39" select="/"/>
      <axsl:apply-templates mode="M40" select="/"/>
      <axsl:apply-templates mode="M41" select="/"/>
      <axsl:apply-templates mode="M42" select="/"/>
      <axsl:apply-templates mode="M43" select="/"/>
      <axsl:apply-templates mode="M44" select="/"/>
      <axsl:apply-templates mode="M45" select="/"/>
      <axsl:apply-templates mode="M46" select="/"/>
      <axsl:apply-templates mode="M47" select="/"/>
      <axsl:apply-templates mode="M48" select="/"/>
      <axsl:apply-templates mode="M49" select="/"/>
      <axsl:apply-templates mode="M50" select="/"/>
      <axsl:apply-templates mode="M51" select="/"/>
      <axsl:apply-templates mode="M52" select="/"/>
      <axsl:apply-templates mode="M53" select="/"/>
      <axsl:apply-templates mode="M54" select="/"/>
      <axsl:apply-templates mode="M55" select="/"/>
      <axsl:apply-templates mode="M56" select="/"/>
      <axsl:apply-templates mode="M57" select="/"/>
      <axsl:apply-templates mode="M58" select="/"/>
      <axsl:apply-templates mode="M59" select="/"/>
      <axsl:apply-templates mode="M60" select="/"/>
      <axsl:apply-templates mode="M61" select="/"/>
      <axsl:apply-templates mode="M62" select="/"/>
      <axsl:apply-templates mode="M63" select="/"/>
      <axsl:apply-templates mode="M64" select="/"/>
      <axsl:apply-templates mode="M65" select="/"/>
      <axsl:apply-templates mode="M66" select="/"/>
      <axsl:apply-templates mode="M67" select="/"/>
      <axsl:apply-templates mode="M68" select="/"/>
      <axsl:apply-templates mode="M69" select="/"/>
      <axsl:apply-templates mode="M70" select="/"/>
      <axsl:apply-templates mode="M71" select="/"/>
      <axsl:apply-templates mode="M72" select="/"/>
      <axsl:apply-templates mode="M73" select="/"/>
      <axsl:apply-templates mode="M74" select="/"/>
      <axsl:apply-templates mode="M75" select="/"/>
      <axsl:apply-templates mode="M76" select="/"/>
      <axsl:apply-templates mode="M77" select="/"/>
      <axsl:apply-templates mode="M78" select="/"/>
      <axsl:apply-templates mode="M79" select="/"/>
      <axsl:apply-templates mode="M80" select="/"/>
      <axsl:apply-templates mode="M81" select="/"/>
      <axsl:apply-templates mode="M82" select="/"/>
      <axsl:apply-templates mode="M83" select="/"/>
      <axsl:apply-templates mode="M84" select="/"/>
      <axsl:apply-templates mode="M85" select="/"/>
      <axsl:apply-templates mode="M86" select="/"/>
      <axsl:apply-templates mode="M87" select="/"/>
      <axsl:apply-templates mode="M88" select="/"/>
      <axsl:apply-templates mode="M89" select="/"/>
      <axsl:apply-templates mode="M90" select="/"/>
      <axsl:apply-templates mode="M91" select="/"/>
      <axsl:apply-templates mode="M92" select="/"/>
      <axsl:apply-templates mode="M93" select="/"/>
      <axsl:apply-templates mode="M94" select="/"/>
      <axsl:apply-templates mode="M95" select="/"/>
      <axsl:apply-templates mode="M96" select="/"/>
      <axsl:apply-templates mode="M97" select="/"/>
      <axsl:apply-templates mode="M98" select="/"/>
      <axsl:apply-templates mode="M99" select="/"/>
      <axsl:apply-templates mode="M100" select="/"/>
      <axsl:apply-templates mode="M101" select="/"/>
      <axsl:apply-templates mode="M102" select="/"/>
      <axsl:apply-templates mode="M103" select="/"/>
      <axsl:apply-templates mode="M104" select="/"/>
      <axsl:apply-templates mode="M105" select="/"/>
    </axsl:variable>
    <err:ErrorResponse xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension" SchemaVersion="2.0">
      <axsl:copy-of select="$errors"/>
    </err:ErrorResponse>
  </axsl:template>

<!--SCHEMATRON PATTERNS-->


<!--PATTERN p2-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:IRheader/ptr:Keys/ptr:Key" mode="M4" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="count(../../../../../hd:GovTalkDetails/hd:Keys/hd:Key[@Type = current()/@Type and . = current()]) &gt; 0"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">5005</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Keys in the GovTalkDetails do not match those in the IRheader.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Keys in the IR header must also exist in the GovTalk header with the same value</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M4" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M4" priority="-1"/>
  <axsl:template match="@*|node()" mode="M4" priority="-2">
    <axsl:apply-templates mode="M4" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p1-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:IRheader" mode="M5" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="count(ptr:Keys/ptr:Key) &gt; 0"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">5004</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">At least one key must exist in the IRheader</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>At least one key must exist in the IRheader</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M5" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M5" priority="-1"/>
  <axsl:template match="@*|node()" mode="M5" priority="-2">
    <axsl:apply-templates mode="M5" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p5-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:BusinessInvestmentIncome/ptr:NeitherGoodsNorServicesExported" mode="M6" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:GoodsExported)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6602</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">[6.1N] must not be present if [6.1G] is present</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[6.1N] should not be present if [6.1G] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:ServicesExported)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6607</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">[6.1N] must not be present if [6.1S] is present</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[6.1N] should not be present if [6.1S] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M6" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M6" priority="-1"/>
  <axsl:template match="@*|node()" mode="M6" priority="-2">
    <axsl:apply-templates mode="M6" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p7-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodStart" mode="M7" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../ptr:Description"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6600</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [3.4]. Please complete box [3.2].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If present then [3.2] must be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.))                   or                 not(../../../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:TotalInterestTaxNotDeducted)                   or                 (round(date:seconds(normalize-space((.))) div 86400) = round(date:seconds(normalize-space(../../../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:PeriodStart)) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6661</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [3.4] and box [7.6]. The date in box [7.1] must equal the date in box [3.4]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If both 3.4 [3.4] and 7.6 [7.6] are present then 7.1 [7.1] must equal 3.4 [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.))                   or                 not(                     ../../../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Profit                       or                     ../../../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Loss                     )                   or                 (round(date:seconds(normalize-space(../../../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:PeriodStart)) div 86400) = round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6698</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is a date in box [3.4] and an entry in one or more of boxes [7.26] and [7.27]. The date in box [7.24] must equal the date in box [3.4]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If both [3.4] and one or more of [7.26] and [7.27] are present then [7.24] must equal [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(round(date:seconds(normalize-space(../../../ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:PeriodStart)) div 86400) = round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6699</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [N1.1] must equal the date in box [3.4]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.1] must equal [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M7" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M7" priority="-1"/>
  <axsl:template match="@*|node()" mode="M7" priority="-2">
    <axsl:apply-templates mode="M7" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p8-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodEnd" mode="M8" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:AccountingPeriodStart)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:AccountingPeriodStart)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6601</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [3.5] cannot be earlier than the date in box [3.4]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.5] should be on or after [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.))                   or                 not(../../../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:TotalInterestTaxNotDeducted)                   or                 (round(date:seconds(normalize-space((.))) div 86400) = round(date:seconds(normalize-space(../../../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:PeriodEnd)) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6900</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [3.5] and box [7.6]. The date in box [7.2] must equal the date in box [3.5]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If both [3.5] and [7.6] are present then [7.2] must equal [3.5]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.))                   or                 not(                     ../../../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Profit                       or                     ../../../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Loss                     )                   or                 (round(date:seconds(normalize-space(../../../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:PeriodEnd)) div 86400) = round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6950</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">If both [3.5] and one or more of [7.26] and [7.27] are present then [7.25] must equal [3.5]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If both [3.5] and one or more of [7.26] and [7.27] are present then [7.25] must equal [3.5]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(round(date:seconds(normalize-space(../../../ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:PeriodEnd)) div 86400) = round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6901</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [N1.2] must equal the date in box [3.5]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.2] must equal [3.5]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M8" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M8" priority="-1"/>
  <axsl:template match="@*|node()" mode="M8" priority="-2">
    <axsl:apply-templates mode="M8" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p9-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:DidThisPartnershipStart" mode="M9" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.) = 'yes') or ../ptr:DateOfCommencement"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8565</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">[3.7] must be present if [3.7Q] equals 'yes'</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.7] should be present if [3.7Q] equals 'yes'</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M9" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M9" priority="-1"/>
  <axsl:template match="@*|node()" mode="M9" priority="-2">
    <axsl:apply-templates mode="M9" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p10-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:DateOfCommencement" mode="M10" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(round(date:seconds(normalize-space((.))) div 86400) &lt;= round(date:seconds(normalize-space(concat(2026, &quot;-04-05&quot;))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8237</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Date of commencement entered in box 3.7 must be on or before the 5th April of the return year. Please check</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.7] must be on or before the last day of the return year.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(round(date:seconds(normalize-space(concat(2025, &quot;-04-06&quot;))) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8370</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Date of commencement entered in box 3.7 must be on or after the 6th April of the return year. Please check</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.7] must be on or after the first day of the return year.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M10" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M10" priority="-1"/>
  <axsl:template match="@*|node()" mode="M10" priority="-2">
    <axsl:apply-templates mode="M10" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p11-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:DidThisPartnershipCease" mode="M11" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.) = 'yes') or ../ptr:DateOfCessation"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8566</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">[3.8] must be present if [3.8Q] equals 'yes'</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.8] should be present if [3.8Q] equals 'yes'</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M11" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M11" priority="-1"/>
  <axsl:template match="@*|node()" mode="M11" priority="-2">
    <axsl:apply-templates mode="M11" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p12-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:DateOfCessation" mode="M12" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:DateOfCommencement)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:DateOfCommencement)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6603</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [3.8] cannot be earlier than the date in box [3.7]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Date of cessation is valid if and only if this on or after [3.7]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(round(date:seconds(normalize-space(concat(2025, &quot;-04-06&quot;))) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))                   and                 (round(date:seconds(normalize-space((.))) div 86400) &lt;= round(date:seconds(normalize-space(concat(2026, &quot;-04-05&quot;))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6604</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [3.8] must be within the return year. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.8] is present, it must be within the return year</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M12" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M12" priority="-1"/>
  <axsl:template match="@*|node()" mode="M12" priority="-2">
    <axsl:apply-templates mode="M12" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p13-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:CapitalAllowancesSummary/ptr:AnnualInvestmentAllowance" mode="M13" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test=". &lt;= 1500000"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6902</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.13A] exceeds [£1,500,000]. Please check. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.13A] should not exceed [£1,500,000]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M13" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M13" priority="-1"/>
  <axsl:template match="@*|node()" mode="M13" priority="-2">
    <axsl:apply-templates mode="M13" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p14-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:CapitalAllowancesSummary/ptr:TotalAllowances" mode="M14" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((                     sum(../ptr:AnnualInvestmentAllowance)                    + sum(../ptr:ZeroEmissionGoodsVehicleAllowance)                    + sum(../ptr:CapitalAllowancesEquipmentHigherRate)      + sum(../ptr:CapitalAllowancesEquipmentLowerRate)     + sum(../ptr:ZeroEmissionCarAllowanceCapitalAllowances)                    + sum(../ptr:ElectricChargePointAllowanceCapitalAllowances)      + sum(../ptr:TheStructuresAndBuildingsAllowanceCapitalAllowances)      + sum(../ptr:FreeportAndInvestmentZonesStructuresAndBuildingsAllowanceCapitalAllowances)                   + sum(../ptr:OtherCapitalAllowances)                   ))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6605</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.22] must equal ( the sum of [3.13A], [3.14], [3.14A], [3.16], [3.16A], [3.18], [3.18A], [3.18B] and [3.20] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.22] should equal ( the sum of [3.13A], [3.14], [3.14A], [3.16], [3.16A], [3.18], [3.18A], [3.18B] and [3.20] ).</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M14" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M14" priority="-1"/>
  <axsl:template match="@*|node()" mode="M14" priority="-2">
    <axsl:apply-templates mode="M14" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p15-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:CapitalAllowancesSummary/ptr:TotalBalancingCharges" mode="M15" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((                     sum(../ptr:BalancingChargeEquipmentHigherRate)                    + sum(../ptr:BalancingChargeEquipmentLowerRate)                     + sum(../ptr:BalancingChargesForOtherCapitalAllowances)                   ))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6606</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.23] must equal ( the sum of [3.15A], [3.17], and [3.21] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.23] should equal ( the sum of [3.15A], [3.17], and [3.21] ).</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M15" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M15" priority="-1"/>
  <axsl:template match="@*|node()" mode="M15" priority="-2">
    <axsl:apply-templates mode="M15" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p16-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TurnoverBelowLimit/ptr:Turnover" mode="M16" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(   ((((.) - sum(../../ptr:CapitalAllowancesSummary/ptr:TotalBalancingCharges)) *                    round(date:seconds(date:difference(concat(2026 - 1, '-04-06'), concat(2026, '-04-06'))) div 86400)                  div (round(date:seconds(date:difference(string(../../ptr:AccountingPeriodStart), string(../../ptr:AccountingPeriodEnd))) div 86400) + 1)) - (90000) &lt;= -0.001) )   or (   ((((.) - sum(../../ptr:CapitalAllowancesSummary/ptr:TotalBalancingCharges)) *                    round(date:seconds(date:difference(concat(2026 - 1, '-04-06'), concat(2026, '-04-06'))) div 86400)                  div (round(date:seconds(date:difference(string(../../ptr:AccountingPeriodStart), string(../../ptr:AccountingPeriodEnd))) div 86400) + 1)) - (15000000) &gt;= 0.001) )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8200</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">([3.24] - [3.23]) multiplied by days in return year (365 or 366) divided by days in period which begins in [3.4] and ends in [3.5] must be less than [£90,000] or greater than [£15,000,000]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>([3.24] - [3.23]) multiplied by days in return year (365 or 366) divided by days in period which begins in [3.4] and ends in [3.5] must be &lt; [£90,000] or &gt; [£15,000,000].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../ptr:AccountingPeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6608</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [3.24]. Please complete box [3.4].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.24] is present [3.4] must be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../ptr:AccountingPeriodEnd"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6963</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [3.24]. Please complete box [3.5].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.24] is present [3.5] must be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.) &gt; 15000000)                       or                     ../../../../../ptr:AttachedFiles/ptr:Attachment"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8201</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">As the entry in box [3.24] is greater than [£15,000,000], then [RIM-PTR-ATTACHMENT] must be present. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.24] is present and greater than [£15,000,000] then [RIM-PTR-ATTACHMENT] must be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M16" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M16" priority="-1"/>
  <axsl:template match="@*|node()" mode="M16" priority="-2">
    <axsl:apply-templates mode="M16" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p17-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss" mode="M17" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:Turnover) - sum(../ptr:Expenses))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6609</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.26] must equal ( [3.24] minus [3.25] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.26] should equal ( [3.24] minus [3.25] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M17" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M17" priority="-1"/>
  <axsl:template match="@*|node()" mode="M17" priority="-2">
    <axsl:apply-templates mode="M17" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p18-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:ExcludeVAT" mode="M18" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or not(../ptr:IncludeVAT = 'yes')"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6610</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Box [3.28] must be absent if there is an entry in box [3.27]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Must not be Y if [3.27] is Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M18" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M18" priority="-1"/>
  <axsl:template match="@*|node()" mode="M18" priority="-2">
    <axsl:apply-templates mode="M18" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p19-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:SalesBusinessIncome" mode="M19" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(.) and ../../ptr:AccountingPeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6611</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [3.29]. Please complete box [3.4].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Sales business income is valid if and only if [3.4] present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../../ptr:TurnoverBelowLimit/ptr:Turnover or ../../ptr:TurnoverBelowLimit/ptr:Expenses or ../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6612</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [3.29]. Boxes [3.24], [3.25] and [3.26] must be absent. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If present, [3.24], [3.25] and [3.26] must be absent</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M19" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M19" priority="-1"/>
  <axsl:template match="@*|node()" mode="M19" priority="-2">
    <axsl:apply-templates mode="M19" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p20-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:GrossProfitLoss" mode="M20" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:SalesBusinessIncome) - (sum(../ptr:CostOfSales) + sum(../ptr:SubcontractorCosts) + sum(../ptr:OtherDirectCosts))))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6613</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.49] must equal ( [3.29] minus ( the sum of [3.46], [3.47], and [3.48] ) ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.49] should equal ( [3.29] minus ( the sum of [3.46], [3.47], and [3.48] ) )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M20" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M20" priority="-1"/>
  <axsl:template match="@*|node()" mode="M20" priority="-2">
    <axsl:apply-templates mode="M20" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p21-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:OtherIncomeProfits" mode="M21" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(.) and not(../../ptr:TurnoverBelowLimit/ptr:Turnover) and not(../../ptr:TurnoverBelowLimit/ptr:Expenses) and not(../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss) and ../../ptr:AccountingPeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6614</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">box [3.50] is valid if not [3.24] and not [3.25] and not [3.26] and [3.4]</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Other income profits is valid if and only if not [3.24] and not [3.25] and not [3.26] and [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M21" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M21" priority="-1"/>
  <axsl:template match="@*|node()" mode="M21" priority="-2">
    <axsl:apply-templates mode="M21" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p22-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DepreciationAndLoss" mode="M22" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../ptr:DisallowableDepreciation"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6615</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [3.62]. Please complete box [3.44].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If present [3.44] must be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M22" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M22" priority="-1"/>
  <axsl:template match="@*|node()" mode="M22" priority="-2">
    <axsl:apply-templates mode="M22" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p23-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:TotalExpenses" mode="M23" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:EmployeeCosts) + sum(../ptr:PremisesCosts) + sum(../ptr:Repairs) + sum(../ptr:GeneralAdministrativeExpenses) + sum(../ptr:MotorExpenses) + sum(../ptr:TravelAndSubsistence) + sum(../ptr:AdvertisingEtc) + sum(../ptr:LegalAndProfessionalCosts) + sum(../ptr:BadDebts) + sum(../ptr:Interest) + sum(../ptr:OtherFinanceCharges) + sum(../ptr:DepreciationAndLoss) + sum(../ptr:OtherExpenses)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6616</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.64] must equal ( the sum of [3.51], [3.52], [3.53], [3.54], [3.55], [3.56], [3.57], [3.58], [3.59], [3.60], [3.61], [3.62], &amp; [3.63] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.64] should equal ( the sum of [3.51], [3.52], [3.53], [3.54], [3.55], [3.56], [3.57], [3.58], [3.59], [3.60], [3.61], [3.62], and [3.63] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M23" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M23" priority="-1"/>
  <axsl:template match="@*|node()" mode="M23" priority="-2">
    <axsl:apply-templates mode="M23" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p24-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:NetProfitOrLoss" mode="M24" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (((sum(../ptr:GrossProfitLoss) + sum(../ptr:OtherIncomeProfits)) - sum(../ptr:TotalExpenses)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6617</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.65] must equal ( ( [3.49] plus [3.50] ) minus [3.64] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.65] should equal ( ( [3.49] plus [3.50] ) minus [3.64] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M24" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M24" priority="-1"/>
  <axsl:template match="@*|node()" mode="M24" priority="-2">
    <axsl:apply-templates mode="M24" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p25-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:DisallowableExpenses" mode="M25" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((.) - ((sum(../../../ptr:IncomeAndExpenses/ptr:TotalExpenses) + sum(../../../ptr:IncomeAndExpenses/ptr:CostOfSales) + sum(../../../ptr:IncomeAndExpenses/ptr:SubcontractorCosts) + sum(../../../ptr:IncomeAndExpenses/ptr:OtherDirectCosts))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6618</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.66] exceeds ( the sum of [3.64], [3.46], [3.47], and [3.48] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.66] should not exceed ( the sum of [3.64], [3.46], [3.47], and [3.48] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableCostOfSales) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableSubContractorCosts) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableDirectCosts) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableEmployeeCosts) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowablePremisesCosts) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableRepairs) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableAdminExpenses) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableMotorExpenses) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableTravelExpenses) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableAdvertisingExpenses) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableLegalProfessionalCost) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableBadDebts) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableInterest) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableOtherFinanceCharges) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableDepreciation) + sum(../../../ptr:IncomeAndExpenses/ptr:DisallowableOtherExpenses))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6619</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.66] must equal sum of ([3.30], [3.31], [3.32], [3.33], [3.34], [3.35], [3.36], [3.37], [3.38], [3.39], [3.40], [3.41], [3.42], [3.43], [3.44], [3.45]). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Must equal sum of ([3.30], [3.31], [3.32], [3.33], [3.34], [3.35], [3.36], [3.37], [3.38], [3.39], [3.40], [3.41], [3.42], [3.43], [3.44], [3.45])</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M25" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M25" priority="-1"/>
  <axsl:template match="@*|node()" mode="M25" priority="-2">
    <axsl:apply-templates mode="M25" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p26-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditionsToNetProfit" mode="M26" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:DisallowableExpenses) + sum(../ptr:GoodsTakenForPersonalUse) + sum(../ptr:BalancingCharge)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6620</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.69] must equal ( the sum of [3.66], [3.67], and [3.68] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.69] should equal ( the sum of [3.66], [3.67], and [3.68] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M26" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M26" priority="-1"/>
  <axsl:template match="@*|node()" mode="M26" priority="-2">
    <axsl:apply-templates mode="M26" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p27-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:CapitalAllowances" mode="M27" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(.) and ((. = sum(../../../ptr:CapitalAllowancesSummary/ptr:TotalAllowances)) or ../../../ptr:TurnoverBelowLimit/ptr:Turnover or ../../../ptr:TurnoverBelowLimit/ptr:Expenses or ../../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6621</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">box [3.70] is valid if it equals [3.22] or [3.24] present or [3.25] present or [3.26] present</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.70] should equal [3.22] or [3.24] present or [3.25] present or [3.26] present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M27" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M27" priority="-1"/>
  <axsl:template match="@*|node()" mode="M27" priority="-2">
    <axsl:apply-templates mode="M27" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p28-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductionsFromNetProfit" mode="M28" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:CapitalAllowances) + sum(../ptr:Deductions)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6622</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.72] must equal ( [3.70] plus [3.71] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.72] should equal ( [3.70] plus [3.71] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M28" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M28" priority="-1"/>
  <axsl:template match="@*|node()" mode="M28" priority="-2">
    <axsl:apply-templates mode="M28" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p29-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:NetProfitLoss" mode="M29" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../../ptr:IncomeAndExpenses/ptr:NetProfitOrLoss) + sum(../ptr:AdditionsToNetProfit/ptr:TotalAdditionsToNetProfit) - sum(../ptr:DeductionsFromNetProfit/ptr:TotalDeductionsFromNetProfit))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6624</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.73] must equal [3.65] + [3.69] - [3.72]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Must equal [3.65] + [3.69] - [3.72]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../ptr:AccountingPeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6625</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [3.73]. Please complete box [3.4].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.73] is present [3.4] must be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../../ptr:TurnoverBelowLimit/ptr:Turnover or ../../ptr:TurnoverBelowLimit/ptr:Expenses or ../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6626</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [3.73]. Boxes [3.24], [3.25], [3.26] must be absent. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If present, all of the following must be absent: [3.24], [3.25], [3.26]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M29" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M29" priority="-1"/>
  <axsl:template match="@*|node()" mode="M29" priority="-2">
    <axsl:apply-templates mode="M29" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p31-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:NetProfit" mode="M30" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../ptr:DetailsNotRequired  or  ../ptr:ProvisionalProfitLoss  or  (   (      (not(../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss) or sum(../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss) &lt; 0)      or      (.) = sum(../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss)   )    and    (      (../../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss or not(../../ptr:TaxAdjustments/ptr:NetProfitLoss &gt;= 0))      or      (.) = sum(../../ptr:TaxAdjustments/ptr:NetProfitLoss)   ) )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6627</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">box [3.83] is valid if [3.10] != 'no' or [3.93] != 'no', or alternatively if one of the following conditions is met: if [3.26] is present and non-negative, then this must equal [3.26]; otherwise, if [3.26] is absent and [3.73] is non-negative then this must equal [3.73]</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Net profit is valid if and only if [3.10] != 'no' or [3.93] != 'no', or alternatively if one of the following conditions is met: if [3.26] is present and non-negative, then this must equal [3.26]; otherwise, if [3.26] is absent and [3.73] is non-negative then this must equal [3.73]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M30" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M30" priority="-1"/>
  <axsl:template match="@*|node()" mode="M30" priority="-2">
    <axsl:apply-templates mode="M30" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p32-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:AllowableLoss" mode="M31" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="sum(../ptr:NetProfit) = 0 or (.) = 0"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6629</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">If [3.84] is a loss [3.83] must be absent or zero. If [3.83] is a profit then [3.84] must be absent or zero.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.84] is a loss [3.83] must be absent or zero. If [3.83] is a profit then [3.84] MUST BE ABSENT OR ZERO</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M31" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M31" priority="-1"/>
  <axsl:template match="@*|node()" mode="M31" priority="-2">
    <axsl:apply-templates mode="M31" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p33-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:ProvisionalProfitLoss" mode="M32" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((.) = &quot;yes&quot;) or (../../../../ptr:OtherInformation/ptr:IncludesProvisionalFigures = &quot;yes&quot;)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6903</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [3.93]. Please complete box [10.1].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.93] is Y then [10.1] must also be Y (but the reverse is not true as estimated figures may be present elsewhere on the return)</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M32" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M32" priority="-1"/>
  <axsl:template match="@*|node()" mode="M32" priority="-2">
    <axsl:apply-templates mode="M32" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p30-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss" mode="M33" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(../ptr:DetailsNotRequired != 'no')                 or                  (ptr:ProvisionalProfitLoss != 'no')                 or                 (                   (  not(../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss)                       or                       (sum(../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss) &gt;= 0)                      or                       (sum(ptr:AllowableLoss) = (0 - sum(../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss)))                   )                     and                                       (                      ../ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss                       or                      not(sum(../ptr:TaxAdjustments/ptr:NetProfitLoss) &lt; 0)                      or                      (sum(ptr:AllowableLoss) = (0 - sum(../ptr:TaxAdjustments/ptr:NetProfitLoss)))                   )                 )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8202</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">box [3.93] is valid if [3.10] != 'no' or [3.93] != 'no', or alternatively if one of the following conditions is met: if [3.26] is present and negative, then [3.84] equals the positive equivalent of [3.26]; otherwise, if [3.26] is absent and [3.73] is negative then [3.84] equals the positive equivalent of [3.73]
</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Provisional profit loss is valid if and only if [3.10] != 'no' or [3.93] != 'no', or alternatively if one of the following conditions is met: if [3.26] is present and negative, then [3.84] equals the positive equivalent of [3.26]; otherwise, if [3.26] is absent and [3.73] is negative then [3.84] equals the positive equivalent of [3.73]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M33" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M33" priority="-1"/>
  <axsl:template match="@*|node()" mode="M33" priority="-2">
    <axsl:apply-templates mode="M33" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p34-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:SummaryOfBalanceSheet/ptr:Assets/ptr:TotalAssets" mode="M34" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:PlantMachineryAndMotorVehicles) + sum(../ptr:OtherFixedAssets) + sum(../ptr:StockAndWorkInProgress) + sum(../ptr:DebtorsPrepaymentsEtc) + sum(../ptr:BankEtcBalances) + sum(../ptr:CashInHand)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6631</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.105] must equal ( the sum of [3.99], [3.100], [3.101], [3.102], [3.103], and [3.104] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.105] should equal ( the sum of [3.99], [3.100], [3.101], [3.102], [3.103], and [3.104] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M34" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M34" priority="-1"/>
  <axsl:template match="@*|node()" mode="M34" priority="-2">
    <axsl:apply-templates mode="M34" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p35-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:SummaryOfBalanceSheet/ptr:Liabilities/ptr:TotalLiabilities" mode="M35" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:TradeCreditorsAndAccruals) + sum(../ptr:LoansAndOverdrawnBankAccounts) + sum(../ptr:OtherLiabilities)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6632</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.109] must equal ( the sum of [3.106], [3.107], and [3.108] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.109] should equal ( the sum of [3.106], [3.107], and [3.108] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M35" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M35" priority="-1"/>
  <axsl:template match="@*|node()" mode="M35" priority="-2">
    <axsl:apply-templates mode="M35" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p36-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:SummaryOfBalanceSheet/ptr:NetBusinessAssets" mode="M36" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:Assets/ptr:TotalAssets) - sum(../ptr:Liabilities/ptr:TotalLiabilities)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6633</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.110] must equal ( [3.105] minus [3.109] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.110] should equal ( [3.105] minus [3.109] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M36" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M36" priority="-1"/>
  <axsl:template match="@*|node()" mode="M36" priority="-2">
    <axsl:apply-templates mode="M36" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p37-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:SummaryOfBalanceSheet/ptr:PartnersCurrentAndCapitalAccounts/ptr:BalanceAtEndOfPeriod" mode="M37" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (((sum(../ptr:BalanceAtStartOfPeriod) + sum(../ptr:NetProfitLoss) + sum(../ptr:CapitalIntroduced)) - sum(../ptr:Drawings)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6634</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.115] must equal ( ( the sum of [3.111], [3.112], and [3.113] ) minus [3.114] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.115] should equals ( ( the sum of [3.111], [3.112], and [3.113] ) minus [3.114] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M37" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M37" priority="-1"/>
  <axsl:template match="@*|node()" mode="M37" priority="-2">
    <axsl:apply-templates mode="M37" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p6-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income" mode="M38" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(not(ptr:IncomeAndExpenses/ptr:SalesBusinessIncome) and not(ptr:IncomeAndExpenses/ptr:OtherIncomeProfits) and not(ptr:TaxAdjustments/ptr:NetProfitLoss)) or (sum(ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:BalancingCharge) = sum(ptr:CapitalAllowancesSummary/ptr:TotalBalancingCharges))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6962</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [3.68] must equal the amount in box [3.23] if there is an entry in any of boxes ([3.29], [3.50], [3.73]). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Balancing charge must equal total balancing charges if any of [3.29] or [3.50] or [3.73] are present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M38" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M38" priority="-1"/>
  <axsl:template match="@*|node()" mode="M38" priority="-2">
    <axsl:apply-templates mode="M38" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p39-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:PeriodEnd" mode="M39" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:PeriodStart)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:PeriodStart)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6635</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [N1.2] cannot be earlier than the date in box [N1.1]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.2] should be on or after [N1.1]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M39" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M39" priority="-1"/>
  <axsl:template match="@*|node()" mode="M39" priority="-2">
    <axsl:apply-templates mode="M39" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p40-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:UsesCTrules" mode="M40" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../../../../ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TotalRentsEtc)                   or                 ../../../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TraditionalAccounting"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8554</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">If there in an entry in box [N1.4] and at least one entry in [2.11] is present then [2.8A] must be submitted. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [N1.4] and at least one [2.11] is present then [2.8A] must be submitted</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M40" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M40" priority="-1"/>
  <axsl:template match="@*|node()" mode="M40" priority="-2">
    <axsl:apply-templates mode="M40" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p41-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:ProfitHasForeignTaxDeducted" mode="M41" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or ../ptr:TradeProfit"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6636</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [N1.A]. Please complete box [N1.11].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.11] must be present if [N1.A] = Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M41" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M41" priority="-1"/>
  <axsl:template match="@*|node()" mode="M41" priority="-2">
    <axsl:apply-templates mode="M41" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p42-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:LossHasForeignTaxDeducted" mode="M42" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or ../ptr:TradeLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6637</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [N1.B]. Please complete box [N1.12].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.12] must be present if [N1.B] = Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M42" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M42" priority="-1"/>
  <axsl:template match="@*|node()" mode="M42" priority="-2">
    <axsl:apply-templates mode="M42" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p43-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:ForeignSavingsHasForeignTaxDeducted" mode="M43" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or ../ptr:UntaxedForeignSavingsIncome"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6638</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [N1.C]. Please complete box [N1.14].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.14] must be present if [N1.C] = Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M43" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M43" priority="-1"/>
  <axsl:template match="@*|node()" mode="M43" priority="-2">
    <axsl:apply-templates mode="M43" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p44-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:OtherUntaxedForeignIncomeHasForeignTaxDeducted" mode="M44" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or ../ptr:IncomeFromLandAndPropertyAbroad"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6639</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [N1.D]. Please complete box [N1.17].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.17] must be present if [N1.D] = Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M44" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M44" priority="-1"/>
  <axsl:template match="@*|node()" mode="M44" priority="-2">
    <axsl:apply-templates mode="M44" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p45-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:IncomeFromOffshoreFundsHasForeignTaxDeducted" mode="M45" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or ../ptr:IncomeFromOffshoreFunds"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6640</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [N1.E]. Please complete box [N1.18].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Must be present if [N1.E] = Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M45" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M45" priority="-1"/>
  <axsl:template match="@*|node()" mode="M45" priority="-2">
    <axsl:apply-templates mode="M45" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p46-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:OtherTaxedIncomeHasForeignTaxDeducted" mode="M46" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(. = 'yes') or ../ptr:OtherTaxedIncome"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6641</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [N1.H]. Please complete box [N1.23].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.23] must be present if [N1.H] = Y</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M46" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M46" priority="-1"/>
  <axsl:template match="@*|node()" mode="M46" priority="-2">
    <axsl:apply-templates mode="M46" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p47-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnerDetails/ptr:PartnerUTR" mode="M47" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="('1111111111' != (.))                  and               ('2222222222' != (.))                  and               ('3333333333' != (.))                  and               ('4444444444' != (.))                  and               ('5555555555' != (.))                  and               ('6666666666' != (.))                  and               ('7777777777' != (.))                  and               ('8888888888' != (.))                  and               ('9999999999' != (.))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6965</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The entry must be 10 numeric characters, but not 1111111111, 2222222222, 3333333333, 4444444444, 5555555555, 6666666666, 7777777777, 8888888888, 9999999999. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Must be 10 numeric characters, but not 1111111111, 2222222222, 3333333333, 4444444444, 5555555555, 6666666666, 7777777777, 8888888888, 9999999999</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(((11 - (((6 * substring((.), 2, 1)) + (7 * substring((.), 3, 1)) + (8 * substring((.), 4, 1)) + (9 * substring((.), 5, 1)) + (10 * substring((.), 6, 1)) + (5 * substring((.), 7, 1)) + (4 * substring((.), 8, 1)) + (3 * substring((.), 9, 1)) + (2 * substring((.), 10, 1))) mod 11)) &gt; 9) and (substring((.), 1, 1) = (11 - (((6 * substring((.), 2, 1)) + (7 * substring((.), 3, 1)) + (8 * substring((.), 4, 1)) + (9 * substring((.), 5, 1)) + (10 * substring((.), 6, 1)) + (5 * substring((.), 7, 1)) + (4 * substring((.), 8, 1)) + (3 * substring((.), 9, 1)) + (2 * substring((.), 10, 1))) mod 11)) - 9))                 or                 (substring((.), 1, 1) = (11 - (((6 * substring((.), 2, 1)) + (7 * substring((.), 3, 1)) + (8 * substring((.), 4, 1)) + (9 * substring((.), 5, 1)) + (10 * substring((.), 6, 1)) + (5 * substring((.), 7, 1)) + (4 * substring((.), 8, 1)) + (3 * substring((.), 9, 1)) + (2 * substring((.), 10, 1))) mod 11)))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8205</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The entry must be valid against the UTR algorithm. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Must be valid against the UTR algorithm</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M47" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M47" priority="-1"/>
  <axsl:template match="@*|node()" mode="M47" priority="-2">
    <axsl:apply-templates mode="M47" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p48-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement/ptr:PartnerDetails/ptr:DateCeased" mode="M48" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:DateAppointed)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:DateAppointed)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6642</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [N2.9] cannot be earlier than the date in box [N2.7]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N2.9] should be on or after [N2.7]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M48" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M48" priority="-1"/>
  <axsl:template match="@*|node()" mode="M48" priority="-2">
    <axsl:apply-templates mode="M48" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p38-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:PartnershipStatement" mode="M49" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:TradeProfit)) - (sum(../ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:NetProfit))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6904</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.11] must equal the amount in box [3.83]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.11] must be equal to [3.83].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:TradeLoss)) - (sum(../ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:AllowableLoss))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6905</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.12] must equal the amount in box [3.84]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.12] must be equal to [3.84].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:UntaxedUKsavingsIncome)) - (sum(../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:TotalInterestTaxNotDeducted))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6906</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.13] must equal the amount in box [7.6]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.13] must be equal to [7.6].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:UntaxedForeignSavingsIncome)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalIncomeRemittable))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6907</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.14] must equal the amount in box [2.6]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.14] must be equal to [2.6].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:OtherUntaxedUKincome)) - (sum(../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Profit))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6908</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.15] must equal the amount in box [7.26]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.15] must be equal to [7.26].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:LossFromOtherUntaxedUKincome)) - (sum(../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Loss))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6909</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.16] must equal the amount in box [7.27]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.16] must be equal to [7.27].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:IncomeFromLandAndPropertyAbroad)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalGross))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6910</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.17] must equal the amount in box [2.7]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.17] must be equal to [2.7].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:IncomeFromOffshoreFunds)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:DisposalsOfOffshoreFunds))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6911</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.18] must equal the amount in box [2.9]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.18] must be equal to [2.9].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:ProfitLossOnUKlandAndProperty)) - (sum(../../ptr:PartnershipLandProperty/ptr:Property/ptr:ProfitLossForReturnPeriod))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6912</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.19] must equal the amount in box [1.39]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.19] must be equal to [1.39].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:LossOnForeignLetProperty)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:ForeignLettingsLoss))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6915</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.21] must equal the amount in box [2.10].Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.21] must be equal to [2.10].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:TaxedSavings)) - (sum(../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:TotalGross))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6916</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.22] must equal the amount in box [7.18]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.22] must be equal to [7.18].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:OtherTaxedIncome)) - (sum(../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithTaxDeducted/ptr:Gross))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6917</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.23] must equal the amount in box [7.30]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.23] must be equal to [7.30].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:CIS25deductions)) - (sum(../ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:SubcontractorsDeductionsOnAccountOfTax))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6964</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.24] must equal the amount in box [3.97]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[N1.24] must equal [3.97]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:UKincomeTax)) - ((                 sum(../../ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:TotalTaxDeducted) +                  sum(../../ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithTaxDeducted/ptr:Tax) +                  sum(../../ptr:PartnershipLandProperty/ptr:Property/ptr:Income/ptr:RentsEtc/ptr:TaxDeducted)                ))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6948</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.25] must equal the sum of [7.17], [7.29] and [1.22]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.25] must be equal to the sum of [7.17], [7.29] and [1.22].
</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:ForeignTaxPaid)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalForeignTax))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6919</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.28] must equal the amount in box [2.8]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.28] must be equal to [2.8].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:PartnershipCharges)) - (sum(../ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:NetPartnershipCharges))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6920</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.29] must equal the amount in box [3.117]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.29] must be equal to [3.117].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:TotalDisposalChargeableAssets)) - (sum(../../ptr:PartnershipChargeableAssets/ptr:TotalProceeds))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6921</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.30] must equal the amount in box [4.1]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.30] must be equal to [4.1].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:ChangeOfBasis)) - (sum(../ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:ChangeOfBasis))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6922</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.11A] must equal the amount in box [3.82]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.11A] must be equal to [3.82].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:TaxedSavingsAtLowerDividendRate)) - (sum(../../ptr:PartnershipSavings/ptr:Dividends/ptr:TotalDividends))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6923</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.22A] must equal the amount in box [7.23]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.22A] must be equal to [7.23].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((sum(ptr:PartnershipInformation/ptr:ForeignDividends)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalDividendsIncomeRemittable))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8428</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.14A] must equal the amount in box [2.6A]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.14A] must be equal to [2.6A].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((sum(ptr:PartnershipInformation/ptr:ResidentialFinanceCostsUK)) - (sum(../../ptr:PartnershipLandProperty/ptr:Property/ptr:ResidentialFinanceCosts)) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8449</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">If [Partnership statement] is present the amount in box [N1.26] must be less than or equal to the amount in box [1.40]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.26] must be less than or equal to [1.40].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((sum(ptr:PartnershipInformation/ptr:ResidentialFinanceCostsForeign)) - (sum(../../ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:ResidentialFinanceCosts)) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8450</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">If [Partnership statement] is present the amount in box [N1.27] must be less than or equal to the amount in box [2.10A]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [Partnership statement] is present [N1.27] must be less than or equal to [2.10A].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:ResidentialFinanceCostsUK) - sum(ptr:PartnerDetails/ptr:ResidentialFinanceCostsUK))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8451</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [N1.26] must be equal to the total of all the amounts in the [N2.26] boxes. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The total of all iterations of [N2.26] must equal [N1.26] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:ResidentialFinanceCostsForeign) - sum(ptr:PartnerDetails/ptr:ResidentialFinanceCostsForeign))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8452</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The total of all occurrences of [N2.27] must equal [N1.27].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The total of all iterations of [N2.27] must equal [N1.27] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:TradeProfit) - sum(ptr:PartnerDetails/ptr:TradeProfit))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6924</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.11] must equal the amount in box [N1.11]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.11] must be equal to [N1.11] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:TradeLoss) - sum(ptr:PartnerDetails/ptr:TradeLoss))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6925</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.12] must equal the amount in box [N1.12]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.12] must be equal to [N1.12] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:UntaxedUKsavingsIncome) - sum(ptr:PartnerDetails/ptr:UKsavingsIncome))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6926</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.13] must equal the amount in box [N1.13]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.13] must be equal to [N1.13] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:UntaxedForeignSavingsIncome) - sum(ptr:PartnerDetails/ptr:UntaxedForeignSavingsIncome))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6927</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.14] must equal the amount in box [N1.14]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.14] must be equal to [N1.14] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:OtherUntaxedUKincome) - sum(ptr:PartnerDetails/ptr:OtherUntaxedUKincome))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6928</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.15] must equal the amount in box [N1.15]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.15] must be equal to [N1.15] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:LossFromOtherUntaxedUKincome) - sum(ptr:PartnerDetails/ptr:LossFromOtherUntaxedUKincome))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6929</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.16] must equal the amount in box [N1.16]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.16] must be equal to [N1.16] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:IncomeFromLandAndPropertyAbroad) - sum(ptr:PartnerDetails/ptr:IncomeFromLandAndPropertyAbroad))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6930</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.17] must equal the amount in box [N1.17]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.17] must be equal to [N1.17] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:IncomeFromOffshoreFunds) - sum(ptr:PartnerDetails/ptr:IncomeFromOffshoreFunds))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6931</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.18] must equal the amount in box [N1.18]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.18] must be equal to [N1.18] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:ProfitLossOnUKlandAndProperty) - sum(ptr:PartnerDetails/ptr:ProfitLossOnUKlandAndProperty))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6932</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.19] must equal the amount in box [N1.19]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.19] must be equal to [N1.19] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:LossOnForeignLetProperty) - sum(ptr:PartnerDetails/ptr:LossOnForeignLetProperty))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6935</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.21] must equal the amount in box [N1.21]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.21] must be equal to [N1.21] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:TaxedSavings) - sum(ptr:PartnerDetails/ptr:TaxedSavings))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6936</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.22] must equal the amount in box [N1.22]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.22] must be equal to [N1.22] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:OtherTaxedIncome) - sum(ptr:PartnerDetails/ptr:OtherTaxedIncome))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6937</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.23] must equal the amount in box [N1.23]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.23] must be equal to [N1.23] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:CIS25deductions) - sum(ptr:PartnerDetails/ptr:CIS25deductions))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6938</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.24] must equal the amount in box [N1.24]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.24] must be equal to [N1.24] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:UKincomeTax) - sum(ptr:PartnerDetails/ptr:UKincomeTax))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6939</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.25] must equal the amount in box [N1.25]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.25] must be equal to [N1.25] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:ForeignTaxPaid) - sum(ptr:PartnerDetails/ptr:ForeignTaxPaid))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6942</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.28] must equal the amount in box [N1.28]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.28] must be equal to [N1.28] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:PartnershipCharges) - sum(ptr:PartnerDetails/ptr:PartnershipCharges))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6943</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.29] must equal the amount in box [N1.29]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.29] must be equal to [N1.29] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:TotalDisposalChargeableAssets) - sum(ptr:PartnerDetails/ptr:DisposalOfChargeableAssets))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6944</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.30] must equal the amount in box [N1.30]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.30] must be equal to [N1.30] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:ChangeOfBasis) - sum(ptr:PartnerDetails/ptr:ChangeOfBasis))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6945</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.11A] must equal the amount in box [N1.11A]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.11A] must be equal to [N1.11A] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:TaxedSavingsAtLowerDividendRate) - sum(ptr:PartnerDetails/ptr:TaxedSavingsAtLowerDividendRate))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6946</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.22A] must equal the amount in box [N1.22A]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.22A] must be equal to [N1.22A] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="((math:abs(sum(ptr:PartnershipInformation/ptr:ForeignDividends) - sum(ptr:PartnerDetails/ptr:OverseasDividends))) - (1.00) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8322</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of all occurrences of box [N2.14A] must equal the amount in box [N1.14A]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>The sum of all iterations of [N2.14A] must be equal to [N1.14A] +/- £1 tolerance.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M49" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M49" priority="-1"/>
  <axsl:template match="@*|node()" mode="M49" priority="-2">
    <axsl:apply-templates mode="M49" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p49-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:OtherInformation/ptr:TaxPayerAddress" mode="M50" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Line[1])                 or               ptr:Line[2]"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8239</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in A11. Please complete A12.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If A11 is present, A12 must be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:ShortLine[1])                 or               (                 ptr:Line[1]                   and                 ptr:Line[2]                   and                 ptr:Line[3]               )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8240</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in A14. Please complete A11, A12 and A13.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If A14 is present, then A11, A12 and A13 must be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M50" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M50" priority="-1"/>
  <axsl:template match="@*|node()" mode="M50" priority="-2">
    <axsl:apply-templates mode="M50" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p50-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership/ptr:OtherInformation/ptr:TaxAvoidanceSchemes" mode="M51" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="ptr:Reference                 or               ptr:TaxYearEnd"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8241</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Each repetition of [Tax avoidance schemes] must contain at least one of either [10.2] or [10.3]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Each repetition of [Tax avoidance schemes] must contain at least one of either [10.2] or [10.3].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M51" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M51" priority="-1"/>
  <axsl:template match="@*|node()" mode="M51" priority="-2">
    <axsl:apply-templates mode="M51" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p4-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:Partnership" mode="M52" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TurnoverBelowLimit/ptr:Turnover or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TurnoverBelowLimit/ptr:Expenses) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6952</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.24] or [3.25]. Please complete box [3.26].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.26] should be present if [3.24] or [3.25]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:SalesBusinessIncome or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:CostOfSales or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:SubcontractorCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:OtherDirectCosts) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:GrossProfitLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6953</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.29] or [3.46] or [3.47] or [3.48]. Please complete box [3.49].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.49] should be present if [3.29] or [3.46] or [3.47] or [3.48]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:EmployeeCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:PremisesCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:Repairs or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:GeneralAdministrativeExpenses or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:MotorExpenses or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:TravelAndSubsistence or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:AdvertisingEtc or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:LegalAndProfessionalCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:BadDebts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:Interest or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:OtherFinanceCharges or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DepreciationAndLoss or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:OtherExpenses) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:TotalExpenses"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6954</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.51] or [3.52] or [3.53] or [3.54] or [3.55] or [3.56] or [3.57] or [3.58] or [3.59] or [3.60] or [3.61] or [3.62] or [3.63]. Please complete box [3.64].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.64] should be present if [3.51] or [3.52] or [3.53] or [3.54] or [3.55] or [3.56] or [3.57] or [3.58] or [3.59] or [3.60] or [3.61] or [3.62] or [3.63]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:GrossProfitLoss or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:OtherIncomeProfits or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:TotalExpenses) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:NetProfitOrLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6955</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.49] or [3.50] or [3.64]. Please complete box [3.65].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.65] should be present if [3.49] or [3.50] or [3.64]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableTravelExpenses or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableAdvertisingExpenses or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableLegalProfessionalCost or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableBadDebts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableInterest or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableOtherFinanceCharges or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableDepreciation or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableOtherExpenses) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:DisallowableExpenses"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6956</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.38] or [3.39] or [3.40] or [3.41] or [3.42] or [3.43] or [3.44] or [3.45]. Please complete box [3.66].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.66] should be present if [3.38] or [3.39] or [3.40] or [3.41] or [3.42] or [3.43] or [3.44] or [3.45]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableCostOfSales or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableSubContractorCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableDirectCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableEmployeeCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowablePremisesCosts or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableRepairs or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableAdminExpenses or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:DisallowableMotorExpenses) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:DisallowableExpenses"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6957</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.30] or [3.31] or [3.32] or [3.33] or [3.34] or [3.35] or [3.36] or [3.37]. Please complete box [3.66].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.66] should be present if [3.30] or [3.31] or [3.32] or [3.33] or [3.34] or [3.35] or [3.36] or [3.37]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:DisallowableExpenses or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:GoodsTakenForPersonalUse or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:BalancingCharge) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditionsToNetProfit"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6958</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.66] or [3.67] or [3.68]. Please complete box [3.69].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.69] should be present if [3.66] or [3.67] or [3.68]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:CapitalAllowances or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:Deductions) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductionsFromNetProfit"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6959</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.70] or [3.71]. Please complete box [3.72].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.72] should be present if [3.70] or [3.71]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:IncomeAndExpenses/ptr:NetProfitOrLoss or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditionsToNetProfit or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductionsFromNetProfit) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:NetProfitLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6960</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [3.65] or [3.69] or [3.72]. Please complete box [3.73].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.73] should be present if [3.65] or [3.69] or [3.72]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not((sum(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TurnoverBelowLimit/ptr:NetProfitOrLoss) &gt; 0) or (sum(ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:TaxAdjustments/ptr:NetProfitLoss) &gt; 0)) or ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AdjustmentsForTaxableProfitOrLoss/ptr:NetProfit"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6961</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box ([3.26] exceeds 0) or ([3.73] exceeds 0). Please complete box [3.83].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[3.83] should be present if ([3.26] exceeds 0) or ([3.73] exceeds 0)</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M52" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M52" priority="-1"/>
  <axsl:template match="@*|node()" mode="M52" priority="-2">
    <axsl:apply-templates mode="M52" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p52-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:PartnershipDetails/ptr:ReturnPeriodEnd" mode="M53" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:ReturnPeriodStart)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:ReturnPeriodStart)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6671</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [1.2] cannot be earlier than the date in box[1.1]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.2] should be on or after [1.1]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M53" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M53" priority="-1"/>
  <axsl:template match="@*|node()" mode="M53" priority="-2">
    <axsl:apply-templates mode="M53" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p53-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:Income/ptr:TotalIncome" mode="M54" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:RentsEtc/ptr:Income) + sum(../ptr:ChargeablePremiums) + sum(../ptr:ReversePremiums)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8287</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [1.24] must equal ( the sum of [1.21], [1.23], and [1.23A] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.24] is valid if and only if this equals ( The sum of [1.21], [1.23], and [1.23A] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../../ptr:PartnershipDetails/ptr:ReturnPeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6658</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.24]. Please complete [1.1].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If Total income is present the following should be true: [1.1]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../../../../ptr:Partnership/ptr:PartnershipStatement/ptr:PartnershipInformation/ptr:UsesCTrules) or ../ptr:RentsEtc/ptr:TraditionalAccounting"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8562</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There must be an entry in [1.22A] if there is an entry in [N1.4]  and [1.24] Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.22A] should be present if [N1.4] is present and [1.24] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M54" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M54" priority="-1"/>
  <axsl:template match="@*|node()" mode="M54" priority="-2">
    <axsl:apply-templates mode="M54" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p54-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:Expenses/ptr:TotalExpenses" mode="M55" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:RentEtc) + sum(../ptr:RepairsEtc) + sum(../ptr:Finance) + sum(../ptr:LegalAndProfessionalCosts) + sum(../ptr:CostOfServicesProvided) + sum(../ptr:OtherExpenses)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6682</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [1.31] must equal the sum of [1.25], [1.26], [1.27], [1.28], [1.29], and [1.30]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.31] should equal ( The sum of [1.25], [1.26], [1.27], [1.28], [1.29], and [1.30] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M55" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M55" priority="-1"/>
  <axsl:template match="@*|node()" mode="M55" priority="-2">
    <axsl:apply-templates mode="M55" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p55-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:NetProfitLoss" mode="M56" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:Income/ptr:TotalIncome) - sum(../ptr:Expenses/ptr:TotalExpenses)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6683</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [1.32] must equal [1.24] minus [1.31]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.32] should equal ( [1.24] minus [1.31] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M56" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M56" priority="-1"/>
  <axsl:template match="@*|node()" mode="M56" priority="-2">
    <axsl:apply-templates mode="M56" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p56-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions" mode="M57" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:PrivateUse) + sum(../ptr:BalancingCharges)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6684</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [1.35] must equal [1.33] plus [1.34]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.35] should equal ( [1.33] plus [1.34] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M57" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M57" priority="-1"/>
  <axsl:template match="@*|node()" mode="M57" priority="-2">
    <axsl:apply-templates mode="M57" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p58-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:AnnualInvestmentAllowance" mode="M58" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../../ptr:Income/ptr:RentsEtc/ptr:TraditionalAccounting"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8563</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The entry in box [1.35A] should not be present there is no entry in [1.22A] Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.35A] should not be present if [1.22A] is not present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test=". &lt;= 1500000"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6660</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">[1.35A] is valid only if this does not exceed [£1,500,000]</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.35A] is valid only if this does not exceed [£1,500,000]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M58" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M58" priority="-1"/>
  <axsl:template match="@*|node()" mode="M58" priority="-2">
    <axsl:apply-templates mode="M58" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p59-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions" mode="M59" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:AnnualInvestmentAllowance)    + sum(../ptr:ElectricChargePointAllowance)    + sum(../ptr:TheStructuresAndBuildingsAllowance)    + sum(../ptr:FreeportAndInvestmentZonesStructuresAndBuildingsAllowance)    + sum(../ptr:ZeroEmissionCarAllowance)    + sum(../ptr:CapitalAllowances)           + sum(../ptr:CostsOfReplacingDomesticItems)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6687</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [1.38] must equal the sum of ( [1.35A], [1.35B], [1.35C], [1.35D], [1.35E], [1.36], and [1.37] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] is valid only if this equals ( The sum of [1.35A], [1.35B], [1.35C], [1.35D], [1.35E], [1.36], and [1.37] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M59" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M59" priority="-1"/>
  <axsl:template match="@*|node()" mode="M59" priority="-2">
    <axsl:apply-templates mode="M59" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p57-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit" mode="M60" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:AnnualInvestmentAllowance) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8371</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.35A]. Please complete [1.38]. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.35A] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:ElectricChargePointAllowance) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8374</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.35B]. Please complete [1.38]. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.35B] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TheStructuresAndBuildingsAllowance) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8375</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.35C]. Please complete [1.38]. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.35C] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:FreeportAndInvestmentZonesStructuresAndBuildingsAllowance) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8376</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.35D]. Please complete [1.38]. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.35D] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:ZeroEmissionCarAllowance) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8377</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.35E]. Please complete [1.38]. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.35E] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:CapitalAllowances) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8372</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.36]. Please complete [1.38].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.36] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:CostsOfReplacingDomesticItems) or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8373</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.37]. Please complete [1.38].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.38] should be present if [1.37] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M60" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M60" priority="-1"/>
  <axsl:template match="@*|node()" mode="M60" priority="-2">
    <axsl:apply-templates mode="M60" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p60-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty/ptr:Property/ptr:ProfitLossForReturnPeriod" mode="M61" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../ptr:PartnershipDetails/ptr:ReturnPeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6951</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [1.39]. Please complete [1.1].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If Profit loss for return period is present the following should be true: [1.1]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (((sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions)) - sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6688</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [1.39] must equal ( ( [1.32] plus [1.35] ) minus [1.38] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.39] should equal ( ( [1.32] plus [1.35] ) minus [1.38] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M61" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M61" priority="-1"/>
  <axsl:template match="@*|node()" mode="M61" priority="-2">
    <axsl:apply-templates mode="M61" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p51-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipLandProperty" mode="M62" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not ( ../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodStart )           or           (round(date:seconds(normalize-space(../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodStart)) div 86400) = round(date:seconds(normalize-space(ptr:PartnershipDetails/ptr:ReturnPeriodStart)) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6884</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [1.1] must be the same as the date in box [3.4]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.4] present then [1.1] must equal [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not ( ../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodEnd )           or           (round(date:seconds(normalize-space(../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodEnd)) div 86400) = round(date:seconds(normalize-space(ptr:PartnershipDetails/ptr:ReturnPeriodEnd)) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6885</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [1.2] must be the same as the date in box [3.5]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.5] present then [1.2] must equal [3.5]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:Income/ptr:RentsEtc/ptr:Income) or ptr:Property/ptr:Income/ptr:TotalIncome"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8278</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [1.21]. Please complete box [1.24].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.24] should be present if [1.21] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:Expenses/ptr:RentEtc or ptr:Property/ptr:Expenses/ptr:RepairsEtc or ptr:Property/ptr:Expenses/ptr:Finance or ptr:Property/ptr:Expenses/ptr:LegalAndProfessionalCosts or ptr:Property/ptr:Expenses/ptr:CostOfServicesProvided or ptr:Property/ptr:Expenses/ptr:OtherExpenses) or ptr:Property/ptr:Expenses/ptr:TotalExpenses"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6971</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.25] or [1.26] or [1.27] or [1.28] or [1.29] or [1.30]. Please complete box [1.31].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.31] should be present if [1.25] or [1.26] or [1.27] or [1.28] or [1.29] or [1.30]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:Income/ptr:TotalIncome or ptr:Property/ptr:Expenses/ptr:TotalExpenses) or ptr:Property/ptr:NetProfitLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6972</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.24] or [1.31]. Please complete box [1.32].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.32] should be present if [1.24] or [1.31]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:PrivateUse or ptr:Property/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:BalancingCharges) or ptr:Property/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6973</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.33] or [1.34]. Please complete box [1.35].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.35] should be present if [1.33] or [1.34]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:NetProfitLoss or ptr:Property/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions or ptr:Property/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions) or ptr:Property/ptr:ProfitLossForReturnPeriod"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6975</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [1.32] or [1.35] or [1.38]. Please complete box [1.39].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.39] should be present if [1.32] or [1.35] or [1.38]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:PartnershipDetails/ptr:ReturnPeriodStart) or ptr:PartnershipDetails/ptr:ReturnPeriodEnd"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8279</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [1.1]. Please complete box [1.2].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.2] should be present if [1.1] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:Income/ptr:ChargeablePremiums) or ptr:Property/ptr:Income/ptr:TotalIncome"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8280</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [1.23]. Please complete box [1.24].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.24] should be present if [1.23] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Property/ptr:Income/ptr:ReversePremiums) or ptr:Property/ptr:Income/ptr:TotalIncome"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8281</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [1.23A]. Please complete box [1.24].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[1.24] should be present if [1.23A] is present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M62" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M62" priority="-1"/>
  <axsl:template match="@*|node()" mode="M62" priority="-2">
    <axsl:apply-templates mode="M62" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p63-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:ReturnPeriodEnd" mode="M63" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:ReturnPeriodStart)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:ReturnPeriodStart)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6690</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [2.5] cannot be earlier than the date in box [2.4]. Please amend the incorrect entry. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.5] should be on or after [2.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M63" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M63" priority="-1"/>
  <axsl:template match="@*|node()" mode="M63" priority="-2">
    <axsl:apply-templates mode="M63" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p64-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalIncomeRemittable" mode="M64" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:InterestEtc/ptr:InterestEtcRow/ptr:Gross[not (../ptr:Unremittable = 'yes')]))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6647</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.6] must equal the total of "Gross of [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]" entries with no corresponding tick in "Unremittable tickbox of [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]". Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.6] must equal total of "Gross of [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]" entries with no corresponding tick in "Unremittable tickbox of [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]"</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M64" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M64" priority="-1"/>
  <axsl:template match="@*|node()" mode="M64" priority="-2">
    <axsl:apply-templates mode="M64" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p65-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalDividendsIncomeRemittable" mode="M65" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:Dividends/ptr:DividendsRow/ptr:Gross[not (../ptr:Unremittable = 'yes')]))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6992</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.6A] must equal the total of "Gross of [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]" entries with no corresponding tick in "Unremittable tickbox of [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]". Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.6A] must equal total of "Gross of [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]" entries with no corresponding tick in "Unremittable tickbox of [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]"</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M65" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M65" priority="-1"/>
  <axsl:template match="@*|node()" mode="M65" priority="-2">
    <axsl:apply-templates mode="M65" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p66-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:LandProperty/ptr:Gross" mode="M66" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../../ptr:IncomeLandPropertyAbroad/ptr:TaxableProfit or ../../../ptr:IncomeLandPropertyAbroad/ptr:TotalTaxableProfit"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8455</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [2.3.3] please complete [2.28] or [2.31] </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [2.3.3] is present, [2.28] or [2.31] should be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M66" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M66" priority="-1"/>
  <axsl:template match="@*|node()" mode="M66" priority="-2">
    <axsl:apply-templates mode="M66" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p67-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalGross" mode="M67" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:LandProperty/ptr:Gross) + sum(../ptr:ChargeablePremiums/ptr:Gross))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6993</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">[2.7] must equal total of ([2.3.3] + [2.3A.3])</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.7] must equal total of ([2.3.3] + [2.3A.3])</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M67" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M67" priority="-1"/>
  <axsl:template match="@*|node()" mode="M67" priority="-2">
    <axsl:apply-templates mode="M67" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p68-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:TotalForeignTax" mode="M68" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../ptr:TotalIncomeRemittable or ../ptr:TotalDividendsIncomeRemittable or ../ptr:TotalGross"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6691</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Box [2.8] completed, an entry is required in at least one of the boxes [2.6], [2.6A] and [2.7]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.8] is present. [2.6] or [2.6A] or [2.7] should also be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M68" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M68" priority="-1"/>
  <axsl:template match="@*|node()" mode="M68" priority="-2">
    <axsl:apply-templates mode="M68" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p69-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:ForeignLettingsLoss" mode="M69" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../../ptr:IncomeLandPropertyAbroad/ptr:AllowableLoss or ../../ptr:IncomeLandPropertyAbroad/ptr:TotalAllowableLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8456</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [2.10] please complete [2.29] or [2.34] </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [2.10] is present, [2.29] or [2.34] should be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M69" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M69" priority="-1"/>
  <axsl:template match="@*|node()" mode="M69" priority="-2">
    <axsl:apply-templates mode="M69" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p70-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty/ptr:ResidentialFinanceCosts" mode="M70" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(../../ptr:IncomeLandPropertyAbroad/ptr:ResidentialFinanceCosts or ../../ptr:IncomeLandPropertyAbroad/ptr:TotalAmountFinanceCosts)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8458</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [2.10A] please complete [2.30A] or [2.33A] </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [2.10A] is present, [2.30A] or [2.33A] must be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M70" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M70" priority="-1"/>
  <axsl:template match="@*|node()" mode="M70" priority="-2">
    <axsl:apply-templates mode="M70" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p62-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:ForeignIncomeSavingsLandProperty" mode="M71" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="ptr:ReturnPeriodStart or not(ptr:TotalIncomeRemittable or ptr:TotalDividendsIncomeRemittable or ptr:TotalGross or ptr:TotalForeignTax or ptr:DisposalsOfOffshoreFunds or ptr:ForeignLettingsLoss)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6689</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">An entry in box [2.4] must be present as there is an entry in one or more of boxes [2.6], [2.6A], [2.7], [2.8], [2.9], [2.10]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If any of the following are present - [2.6], [2.6A], [2.7], [2.8], [2.9], [2.10] then [2.4] must be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not ( ptr:InterestEtc/ptr:InterestEtcRow/ptr:Gross[not (../ptr:Unremittable = 'yes')])                or              ptr:TotalIncomeRemittable"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8243</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There are entries in [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -] with no corresponding entry in "Unremittable tickbox of [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]". Please complete box [2.6].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.6] is mandatory if any entries with no corresponding tick in "Unremittable tickbox of [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]" are present in [2.2.1 Country/2.2.2 Unremittable/2.2.3 Gross/2.2.4 Foreign Tax -]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Dividends/ptr:DividendsRow/ptr:Gross[not (../ptr:Unremittable = 'yes')])               or             ptr:TotalDividendsIncomeRemittable"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8244</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There are entries in [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -] with no corresponding entry in "Unremittable tickbox of [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]". Please complete box [2.6A].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.6A] is mandatory if any entries with no corresponding tick in "Unremittable tickbox of [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]" are present in [2.2A.1 Country/2.2A.2 Unremittable/2.2A.3 Gross/2.2A.4 Foreign Tax -]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M71" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M71" priority="-1"/>
  <axsl:template match="@*|node()" mode="M71" priority="-2">
    <axsl:apply-templates mode="M71" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p73-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:Expenses/ptr:TotalExpenditure" mode="M72" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:RentRatesEtc) + sum(../ptr:RepairsAndRenewals) + sum(../ptr:FinanceCharges) + sum(../ptr:LegalAndProfessionalCosts) + sum(../ptr:CostOfServices) + sum(../ptr:OtherExpenses)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6692</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.18] must equal the sum of [2.12], [2.13], [2.14], [2.15], [2.16], and [2.17]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.18] should equal ( The sum of [2.12], [2.13], [2.14], [2.15], [2.16], and [2.17] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M72" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M72" priority="-1"/>
  <axsl:template match="@*|node()" mode="M72" priority="-2">
    <axsl:apply-templates mode="M72" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p72-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:Expenses" mode="M73" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:RentRatesEtc or ptr:RepairsAndRenewals or ptr:FinanceCharges or ptr:LegalAndProfessionalCosts or ptr:CostOfServices or ptr:OtherExpenses) or ptr:TotalExpenditure"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6984</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.12] or [2.13] or [2.14] or [2.15] or [2.16] or [2.17]. Please complete box [2.18].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.18] should be present if [2.12] or [2.13] or [2.14] or [2.15] or [2.16] or [2.17]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M73" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M73" priority="-1"/>
  <axsl:template match="@*|node()" mode="M73" priority="-2">
    <axsl:apply-templates mode="M73" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p74-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:NetProfitLoss" mode="M74" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:TotalRentsEtc) - sum(../ptr:Expenses/ptr:TotalExpenditure)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6693</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.19] must equal [2.11] minus [2.18]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.19] should equal ( [2.11] minus [2.18] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M74" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M74" priority="-1"/>
  <axsl:template match="@*|node()" mode="M74" priority="-2">
    <axsl:apply-templates mode="M74" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p76-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions" mode="M75" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:PrivateUse) + sum(../ptr:BalancingCharges)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6694</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.22] must equal [2.20] plus [2.21]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.22] should equal ( [2.20] plus [2.21] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M75" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M75" priority="-1"/>
  <axsl:template match="@*|node()" mode="M75" priority="-2">
    <axsl:apply-templates mode="M75" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p75-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TaxAdjustments/ptr:AdditionsToNetProfit" mode="M76" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:PrivateUse or ptr:BalancingCharges) or ptr:TotalAdditions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6986</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.20] or [2.21]. Please complete box [2.22].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.22] should be present if [2.20] or [2.21]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M76" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M76" priority="-1"/>
  <axsl:template match="@*|node()" mode="M76" priority="-2">
    <axsl:apply-templates mode="M76" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p78-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions" mode="M77" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:ElectricChargePointAllowance) + sum(../ptr:TheStructuresAndBuildingsAllowance) + sum(../ptr:ZeroEmissionCarAllowance) + sum(../ptr:CapitalAllowances) + sum(../ptr:CostsOfReplacingDomesticItems)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6695</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.25] must equal ( the sum of [2.21A], [2.21B], [2.21C], [2.23] and [2.24] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.25] is valid only if this equals ( The sum of [2.21A], [2.21B], [2.21C], [2.23], and [2.24] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M77" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M77" priority="-1"/>
  <axsl:template match="@*|node()" mode="M77" priority="-2">
    <axsl:apply-templates mode="M77" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p77-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TaxAdjustments/ptr:DeductionsFromNetProfit" mode="M78" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:ElectricChargePointAllowance or ptr:TheStructuresAndBuildingsAllowance or ptr:ZeroEmissionCarAllowance or ptr:CapitalAllowances or ptr:CostsOfReplacingDomesticItems)                   or ptr:TotalDeductions"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6987</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.21A], [2.21B], [2.21C], [2.23] or [2.24]. Please complete box [2.25].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.25] should be present if any of [2.21A], [2.21B], [2.21C], [2.23] or [2.24] are present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M78" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M78" priority="-1"/>
  <axsl:template match="@*|node()" mode="M78" priority="-2">
    <axsl:apply-templates mode="M78" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p79-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:AdjustedProfit" mode="M79" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(   ((sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions) - sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions)) - (0) &gt;= 0.001) and (math:abs((.) - (sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions) - sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions))) &lt; 0.001) ) or (   ((sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions) - sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions)) - (0) &lt; 0.001) and (. = 0) )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6696</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.26] must equal the sum if positive, of [2.19] plus [2.22] minus [2.25], otherwise [2.26] must be zero or absent. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If the sum [2.19] + [2.22] - [2.25]  is positive, [2.26] must equal the sum otherwise [2.26] must be zero or absent</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M79" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M79" priority="-1"/>
  <axsl:template match="@*|node()" mode="M79" priority="-2">
    <axsl:apply-templates mode="M79" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p80-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:AdjustedLoss" mode="M80" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(   ((sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions) - ( sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions) )) - (0) &gt;= 0.001) and (math:abs((.) - (sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions) - ( sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions) ))) &lt; 0.001) ) or (   ((sum(../ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions) - ( sum(../ptr:NetProfitLoss) + sum(../ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions) )) - (0) &lt; 0.001) and (. = 0) )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8288</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [2.27] must equal the positive equivalent of the sum of [2.19] plus [2.22] minus [2.25]  if negative, otherwise [2.27] must be zero or absent. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>if the sum [2.19] + [2.22] - [2.25] is negative, [2.27] must equal the positive equivalent of the sum otherwise [2.27] must be zero or absent</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M80" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M80" priority="-1"/>
  <axsl:template match="@*|node()" mode="M80" priority="-2">
    <axsl:apply-templates mode="M80" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p71-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad" mode="M81" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:TotalRentsEtc or ptr:Expenses/ptr:TotalExpenditure) or ptr:NetProfitLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6985</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.11] or [2.18]. Please complete box [2.19].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.19] should be present if [2.11] or [2.18]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(((((sum(ptr:NetProfitLoss) + sum(ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions)) - sum(ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions))) - (0) &gt;= 0.001)) or ptr:AdjustedProfit"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6994</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of ( ( [2.19] plus [2.22] ) minus [2.25] ) exceeds 0. Please complete box [2.26].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.26] should be present if ( ( [2.19] plus [2.22] ) minus [2.25] ) exceeds 0</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(((((sum(ptr:NetProfitLoss) + sum(ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:TotalAdditions)) - sum(ptr:TaxAdjustments/ptr:DeductionsFromNetProfit/ptr:TotalDeductions))) - (0) &lt;= -0.001)) or ptr:AdjustedLoss"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6995</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The sum of ( ( [2.19] plus [2.22] ) minus [2.25] ) is less than 0. Please complete box [2.27].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.27] should be present if ( ( [2.19] plus [2.22] ) minus [2.25] ) is less than 0</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M81" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M81" priority="-1"/>
  <axsl:template match="@*|node()" mode="M81" priority="-2">
    <axsl:apply-templates mode="M81" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p81-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:MultipleLettings" mode="M82" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(((sum(ptr:MultipleLetting/ptr:TaxableProfitOrLoss)) - (0) &gt;= 0.001)) or ((math:abs((sum(../ptr:TotalTaxableProfit)) - (sum(ptr:MultipleLetting/ptr:TaxableProfitOrLoss))) &lt; 0.001))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8460</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There must be an entry in [2.31] equal to the total occurrences of [2.4.2] if total is positive. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.31] must be present and equal to the total of all iterations of [2.4.2] if total is positive.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(((sum(ptr:MultipleLetting/ptr:TaxableProfitOrLoss)) - (0) &lt;= -0.001)) or ((math:abs((sum(../ptr:TotalAllowableLoss)) - (math:abs(sum(ptr:MultipleLetting/ptr:TaxableProfitOrLoss)))) &lt; 0.001))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8461</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There must be an entry in [2.34]  equal to the absolute value of the total of all occurrences of [2.4.2] if total is negative. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.34] must be present and equal to the absolute value of the total of all iterations of [2.4.2] if total is negative.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M82" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M82" priority="-1"/>
  <axsl:template match="@*|node()" mode="M82" priority="-2">
    <axsl:apply-templates mode="M82" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p82-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:TotalForeignTax" mode="M83" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:MultipleLettings/ptr:MultipleLetting/ptr:ForeignTax))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6650</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Must equal the sum of all occurrences of box [2.4.3]. </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>eq total of all iterations of [2.4.3]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M83" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M83" priority="-1"/>
  <axsl:template match="@*|node()" mode="M83" priority="-2">
    <axsl:apply-templates mode="M83" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p83-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:TotalAmountChargeable" mode="M84" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:MultipleLettings/ptr:MultipleLetting/ptr:AmountChargeable))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6655</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Must equal the sum of all occurrences of box [2.4.4].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>eq total of all iterations of [2.4.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M84" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M84" priority="-1"/>
  <axsl:template match="@*|node()" mode="M84" priority="-2">
    <axsl:apply-templates mode="M84" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p84-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign/ptr:IncomeLandPropertyAbroad/ptr:TotalAmountFinanceCosts" mode="M85" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:MultipleLettings/ptr:MultipleLetting/ptr:ResidentialFinanceCosts))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8462</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The entry in [2.33A] must be equal to the total of all occurrences of [2.4.5]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.33A] must be equal to the total of all iterations of [2.4.5].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M85" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M85" priority="-1"/>
  <axsl:template match="@*|node()" mode="M85" priority="-2">
    <axsl:apply-templates mode="M85" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p61-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipForeign" mode="M86" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not ( ../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodStart )           or           (round(date:seconds(normalize-space(../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodStart)) div 86400) = round(date:seconds(normalize-space(ptr:ForeignIncomeSavingsLandProperty/ptr:ReturnPeriodStart)) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6645</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [2.4] must be the same as the date in box [3.4]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.4] present then [2.4] must equal [3.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not ( ../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodEnd )           or           (round(date:seconds(normalize-space(../ptr:Partnership/ptr:TradingAndProfessionalIncomes/ptr:Income/ptr:AccountingPeriodEnd)) div 86400) = round(date:seconds(normalize-space(ptr:ForeignIncomeSavingsLandProperty/ptr:ReturnPeriodEnd)) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6982</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [2.5] must be the same as the date in box [3.5]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [3.5] present then [2.5] must equal [3.5]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:ForeignIncomeSavingsLandProperty/ptr:ChargeablePremiums/ptr:Gross) or ptr:ForeignIncomeSavingsLandProperty/ptr:TotalGross"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6983</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.3A.3]. Please complete box [2.7].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.7] should be present if [2.3A.3]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:IncomeLandPropertyAbroad/ptr:MultipleLettings/ptr:MultipleLetting/ptr:ForeignTax) or ptr:IncomeLandPropertyAbroad/ptr:TotalForeignTax"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6988</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.4.3]. Please complete box [2.32].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.32] should be present if [2.4.3]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:IncomeLandPropertyAbroad/ptr:MultipleLettings/ptr:MultipleLetting/ptr:AmountChargeable) or ptr:IncomeLandPropertyAbroad/ptr:TotalAmountChargeable"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6989</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [2.4.4]. Please complete box [2.33].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[2.33] should be present if [2.4.4]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="ptr:ForeignIncomeSavingsLandProperty/ptr:TraditionalAccounting or ((((sum(ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TotalRentsEtc) + sum(ptr:IncomeLandPropertyAbroad/ptr:IncomeLandAndPropertyAbroad/ptr:TaxAdjustments/ptr:AdditionsToNetProfit/ptr:BalancingCharges))) - (150000) &lt; 0.001))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8564</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">If there is no entry in [2.8A] then the sum of all instances of ( [2.11] + [2.21] ) must not exceed [£150,000] Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [2.8A] is absent then the sum of all instances of ( [2.11] + [2.21] ) must not exceed [£150,000]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M86" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M86" priority="-1"/>
  <axsl:template match="@*|node()" mode="M86" priority="-2">
    <axsl:apply-templates mode="M86" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p86-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipChargeableAssets/ptr:TotalProceeds" mode="M87" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:Disposals/ptr:DisposalRow/ptr:Proceeds))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6628</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [4.1] must equal the total of [4.1.3]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[4.1] must eq total of [4.1.3]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M87" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M87" priority="-1"/>
  <axsl:template match="@*|node()" mode="M87" priority="-2">
    <axsl:apply-templates mode="M87" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p85-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipChargeableAssets" mode="M88" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Disposals/ptr:DisposalRow/ptr:Proceeds) or ptr:TotalProceeds"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6996</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [4.1.3]. Please complete box [4.1].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[4.1] should be present if [4.1.3]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M88" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M88" priority="-1"/>
  <axsl:template match="@*|node()" mode="M88" priority="-2">
    <axsl:apply-templates mode="M88" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p88-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:PeriodEnd" mode="M89" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:PeriodStart)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:PeriodStart)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6643</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [7.2] cannot be earlier than the date in box [7.1]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.2] should be after [7.1]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M89" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M89" priority="-1"/>
  <axsl:template match="@*|node()" mode="M89" priority="-2">
    <axsl:apply-templates mode="M89" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p89-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxNotDeducted/ptr:TotalInterestTaxNotDeducted" mode="M90" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../ptr:PeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8463</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in box [7.6] please complete [7.1] </axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>If [7.6] is present, [7.1] should be present</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:UntaxedUKinterest) + sum(../ptr:NationalSavings) + sum(../ptr:OtherIncomeFromUKsavings)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">8464</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [7.6] must equal ( the sum of [7.3], [7.4], and [7.5] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.6] should equal the sum of [7.3], [7.4], and [7.5].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M90" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M90" priority="-1"/>
  <axsl:template match="@*|node()" mode="M90" priority="-2">
    <axsl:apply-templates mode="M90" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p90-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:UKinterestPaid/ptr:Tax" mode="M91" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="math:abs(. - sum(../ptr:Gross) * 0.2) &lt;= 1.001"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6651</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Tax must equal Gross Value * Lower savings rate (20%)</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Tax must equal Gross * Lower savings rate [20%]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M91" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M91" priority="-1"/>
  <axsl:template match="@*|node()" mode="M91" priority="-2">
    <axsl:apply-templates mode="M91" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p91-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:UKinterestPaid/ptr:Gross" mode="M92" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="math:abs(. - (sum(../ptr:Net) + sum(../ptr:Tax))) &lt;= 1.001"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6652</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Gross must equal Net plus Tax</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Gross must equal Net + Tax</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M92" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M92" priority="-1"/>
  <axsl:template match="@*|node()" mode="M92" priority="-2">
    <axsl:apply-templates mode="M92" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p92-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:OtherIncome/ptr:Tax" mode="M93" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="math:abs(. - sum(../ptr:Gross) * 0.2) &lt;= 1.001"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6651</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Tax must equal Gross Value * Lower savings rate (20%)</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Tax must equal Gross * Lower savings rate [20%]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M93" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M93" priority="-1"/>
  <axsl:template match="@*|node()" mode="M93" priority="-2">
    <axsl:apply-templates mode="M93" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p93-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:OtherIncome/ptr:Gross" mode="M94" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="math:abs(. - (sum(../ptr:Net) + sum(../ptr:Tax))) &lt;= 1.001"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6652</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Gross must equal Net plus Tax</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Gross must equal Net + Tax</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M94" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M94" priority="-1"/>
  <axsl:template match="@*|node()" mode="M94" priority="-2">
    <axsl:apply-templates mode="M94" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p94-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:TotalTaxDeducted" mode="M95" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:UKinterestPaid/ptr:Tax) + sum(../ptr:OtherIncome/ptr:Tax))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6653</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [7.17] must equal [7.8] + [7.15]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.17] should equal [7.8] + [7.15].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M95" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M95" priority="-1"/>
  <axsl:template match="@*|node()" mode="M95" priority="-2">
    <axsl:apply-templates mode="M95" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p95-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Interest/ptr:TaxDeducted/ptr:TotalGross" mode="M96" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - (sum(../ptr:UKinterestPaid/ptr:Gross) + sum(../ptr:OtherIncome/ptr:Gross))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6654</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [7.18] must equal [7.9] + [7.16]. Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.18] should equal [7.9] + [7.16].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M96" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M96" priority="-1"/>
  <axsl:template match="@*|node()" mode="M96" priority="-2">
    <axsl:apply-templates mode="M96" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p96-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:Dividends/ptr:TotalDividends" mode="M97" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="(math:abs((.) - ((sum(../ptr:UKcompanies) + sum(../ptr:UKauthorisedUnitTrusts) + sum(../ptr:StockDividends) + sum(../ptr:BonusIssuesOfSecuritiesAndRedeemableShares)))) &lt; 0.001)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6665</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The amount in box [7.23] must equal ( the sum of [7.19], [7.20], [7.21], and [7.22] ). Please check.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.23] should equal ( The sum of [7.19], [7.20], [7.21], and [7.22] )</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M97" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M97" priority="-1"/>
  <axsl:template match="@*|node()" mode="M97" priority="-2">
    <axsl:apply-templates mode="M97" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p97-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:PeriodEnd" mode="M98" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(../ptr:PeriodStart)                   or                 not((.))                   or                 (round(date:seconds(normalize-space(../ptr:PeriodStart)) div 86400) &lt;= round(date:seconds(normalize-space((.))) div 86400))"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6666</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The date in box [7.25] cannot be earlier than the date in box [7.24]. Please amend the incorrect entry.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.25] should be after [7.24]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M98" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M98" priority="-1"/>
  <axsl:template match="@*|node()" mode="M98" priority="-2">
    <axsl:apply-templates mode="M98" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p98-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Profit" mode="M99" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../ptr:PeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6667</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [7.26]. Please complete box [7.24].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.26] is present, so [7.24] should be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M99" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M99" priority="-1"/>
  <axsl:template match="@*|node()" mode="M99" priority="-2">
    <axsl:apply-templates mode="M99" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p99-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithoutTaxDeducted/ptr:Loss" mode="M100" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="../ptr:PeriodStart"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6668</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an amount in box [7.27]. Please complete box [7.24].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.27] is present, so [7.24] should be present.</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M100" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M100" priority="-1"/>
  <axsl:template match="@*|node()" mode="M100" priority="-2">
    <axsl:apply-templates mode="M100" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p100-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithTaxDeducted/ptr:Tax" mode="M101" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="math:abs(. - sum(../ptr:Gross) * 0.2) &lt;= 1.001"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6651</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Tax must equal Gross Value * Lower savings rate (20%)</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Tax must equal Gross * Lower savings rate [20%]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M101" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M101" priority="-1"/>
  <axsl:template match="@*|node()" mode="M101" priority="-2">
    <axsl:apply-templates mode="M101" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p101-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings/ptr:OtherIncome/ptr:WithTaxDeducted/ptr:Gross" mode="M102" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="math:abs(. - (sum(../ptr:Net) + sum(../ptr:Tax))) &lt;= 1.001"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6652</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Gross must equal Net plus Tax</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Gross must equal Net + Tax</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M102" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M102" priority="-1"/>
  <axsl:template match="@*|node()" mode="M102" priority="-2">
    <axsl:apply-templates mode="M102" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p87-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:PartnershipSavings" mode="M103" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Interest/ptr:TaxNotDeducted/ptr:UntaxedUKinterest or ptr:Interest/ptr:TaxNotDeducted/ptr:NationalSavings or ptr:Interest/ptr:TaxNotDeducted/ptr:OtherIncomeFromUKsavings) or ptr:Interest/ptr:TaxNotDeducted/ptr:TotalInterestTaxNotDeducted"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6997</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [7.3] or [7.4] or [7.5]. Please complete box [7.6].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.6] should be present if [7.3] or [7.4] or [7.5]</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Interest/ptr:TaxDeducted/ptr:UKinterestPaid/ptr:Tax or ptr:Interest/ptr:TaxDeducted/ptr:OtherIncome/ptr:Tax) or ptr:Interest/ptr:TaxDeducted/ptr:TotalTaxDeducted"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6998</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [7.8] or [7.15]. Please complete box [7.17].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.17] should be present if [7.8] or [7.15].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Interest/ptr:TaxDeducted/ptr:UKinterestPaid/ptr:Gross or ptr:Interest/ptr:TaxDeducted/ptr:OtherIncome/ptr:Gross) or ptr:Interest/ptr:TaxDeducted/ptr:TotalGross"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6999</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [7.9] or [7.16]. Please complete box [7.18].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.18] should be present if [7.9] or [7.16].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(ptr:Dividends/ptr:UKcompanies or ptr:Dividends/ptr:UKauthorisedUnitTrusts or ptr:Dividends/ptr:StockDividends or ptr:Dividends/ptr:BonusIssuesOfSecuritiesAndRedeemableShares) or ptr:Dividends/ptr:TotalDividends"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6882</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">There is an entry in [7.19] or [7.20] or [7.21] or [7.22]. Please complete box [7.23].</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>[7.23] should be present if [7.19] or [7.20] or [7.21] or [7.22].</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M103" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M103" priority="-1"/>
  <axsl:template match="@*|node()" mode="M103" priority="-2">
    <axsl:apply-templates mode="M103" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p102-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:AttachedFiles/ptr:Attachment" mode="M104" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="starts-with(translate(normalize-space(.), ' ', ''), 'JVBERi0x')"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6790</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">The attachment content must be a PDF file</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Attachment content must be a PDF file starting with the byte sequence "%PDF-1" (i.e. the Base 64 encoded content starts with "JVBERi0x").</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M104" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M104" priority="-1"/>
  <axsl:template match="@*|node()" mode="M104" priority="-2">
    <axsl:apply-templates mode="M104" select="@*|node()"/>
  </axsl:template>

<!--PATTERN p3-->


	<!--RULE -->
<axsl:template match="/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership" mode="M105" priority="4000">

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(@AmendedReturn)             or               not(../../../hd:Header/hd:MessageDetails/hd:GatewayTimestamp)             or               (                 date:date(normalize-space(concat(../../../hd:Header/hd:MessageDetails/hd:GatewayTimestamp, 'Z'))) != ''               and                 date:seconds(normalize-space(concat(../../../hd:Header/hd:MessageDetails/hd:GatewayTimestamp, 'Z'))) &lt; date:seconds(normalize-space(date:add(normalize-space('2027-01-31T00:00:00Z'),normalize-space('P1Y1D'))))               )             or               (                 date:date(normalize-space(concat(../../../hd:Header/hd:MessageDetails/hd:GatewayTimestamp, 'Z'))) = ''               and                 date:seconds(normalize-space(../../../hd:Header/hd:MessageDetails/hd:GatewayTimestamp)) &lt; date:seconds(normalize-space(date:add(normalize-space('2027-01-31T00:00:00Z'),normalize-space('P1Y1D'))))               )"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">5090</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">You have indicated an amended submission but the amendment window has now closed for the year of assessment to which your submission relates.</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Date of receipt of amendment must be less than 12 months following statutory due date</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="contains(/hd:GovTalkMessage/hd:Header/hd:MessageDetails/hd:Class, '-ATT') or not(/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:AttachedFiles)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6001</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Submission must not contain any attachments if the message class indicates no attachments</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Submission must not contain any attachments if the message class indicates no attachments</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>

		<!--ASSERT -->
<axsl:choose>
      <axsl:when test="not(contains(/hd:GovTalkMessage/hd:Header/hd:MessageDetails/hd:Class, '-ATT')) or (/hd:GovTalkMessage/hd:Body/ptr:IRenvelope/ptr:SApartnership/ptr:AttachedFiles)"/>
      <axsl:otherwise>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="errorCode">6015</axsl:variable>
        <axsl:variable xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" name="defaultMessage">Submission must contain at least one attachment if the message class indicates attachments</axsl:variable>
        <err:Error xmlns:err="http://www.govtalk.gov.uk/CM/errorresponse" xmlns:dsl="http://decisionsoft.com/rim/errorExtension">
          <err:RaisedBy>ChRIS</err:RaisedBy>
          <err:Number>
            <axsl:value-of select="normalize-space($errorCode)"/>
          </err:Number>
          <err:Type>business</err:Type>
          <err:Text>
            <axsl:choose>
              <axsl:when test="normalize-space($defaultMessage)">
                <axsl:copy-of select="$defaultMessage"/>
              </axsl:when>
              <axsl:otherwise>Submission must contain at least one attachment if the message class indicates attachments</axsl:otherwise>
            </axsl:choose>
          </err:Text>
          <err:Location>
            <axsl:apply-templates mode="schematron-get-full-path" select="."/>
          </err:Location>
        </err:Error>
      </axsl:otherwise>
    </axsl:choose>
    <axsl:apply-templates mode="M105" select="@*|*|comment()|processing-instruction()"/>
  </axsl:template>
  <axsl:template match="text()" mode="M105" priority="-1"/>
  <axsl:template match="@*|node()" mode="M105" priority="-2">
    <axsl:apply-templates mode="M105" select="@*|node()"/>
  </axsl:template>
</axsl:stylesheet>
