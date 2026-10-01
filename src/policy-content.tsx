import type { ReactNode } from "react";

/** The legal copy, held as data rather than as markup so the table of
 *  contents and the document itself are rendered from one list and cannot
 *  drift apart. The wording is the published wording: it is carried over
 *  word for word from the card these pages used to be, and only its
 *  presentation has changed. The analytics section came later, with the
 *  Cloudflare Web Analytics beacon. */

export type PolicySection = {
  id: string;
  title: string;
  body: ReactNode;
};

export type PolicyDocument = {
  title: string;
  /** The first sentence of the opening section, said once more at the top so
   *  the page states what it is before it starts. Not new text. */
  lead: string;
  sections: PolicySection[];
};

/** The one date both documents carry. */
export const policyUpdated = "Last updated September 30, 2026";

const contactAddress = (
  <a className="policy-link" href="mailto:info@wireal.co">
    info@wireal.co
  </a>
);

const privacy: PolicyDocument = {
  title: "Privacy Policy",
  lead: "How the hosted Wireal service at wireal.co handles your information.",
  sections: [
    {
      id: "overview",
      title: "Overview",
      body: (
        <p>
          Wireal is a project workspace for people and coding agents. This
          policy covers the hosted service at wireal.co and explains what
          information it processes, why it is used, and the choices available to
          you. Wireal&apos;s source code is public, and anyone may run their own
          instance; a self-hosted instance is operated by whoever runs it, and
          this policy does not apply to it.
        </p>
      ),
    },
    {
      id: "information-we-process",
      title: "Information we process",
      body: (
        <p>
          We process account information such as your name, email address,
          authentication provider, and provider account identifier. We also
          store the projects, tasks, labels, activity, repository links, and
          activity you choose to add to your workspace. Basic technical and
          security information may be processed when you access the service.
        </p>
      ),
    },
    {
      id: "google-user-data",
      title: "Google user data",
      body: (
        <p>
          When you choose Google sign-in, Wireal requests only basic identity
          information: your name, email address, profile image, and a stable
          account identifier. Wireal does not request access to Gmail, Google
          Drive, contacts, calendars, or other Google services.
        </p>
      ),
    },
    {
      id: "storage-and-service-providers",
      title: "Storage and service providers",
      body: (
        <p>
          Your account and workspace data are stored in the database of the
          Wireal API, which also handles sign-in and checks who may access each
          workspace. Cloudflare delivers the website and related server
          functions and measures aggregate traffic to it through Cloudflare Web
          Analytics, described below. Google and GitHub process information when
          you choose their sign-in services. The browser may keep a local cache
          so the interface remains responsive.
        </p>
      ),
    },
    {
      id: "analytics",
      title: "Analytics",
      body: (
        <p>
          Wireal uses{" "}
          <a
            className="policy-link"
            href="https://www.cloudflare.com/web-analytics/"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare Web Analytics
          </a>{" "}
          to measure aggregate page traffic. It is cookieless, does not
          fingerprint your browser, and does not track you across other sites.
          When a page loads, the browser sends Cloudflare the page URL, the
          referrer, the browser and device type, the country the request came
          from, and page load timings. Cloudflare processes this on
          Wireal&apos;s behalf under its{" "}
          <a
            className="policy-link"
            href="https://www.cloudflare.com/privacypolicy/"
            target="_blank"
            rel="noreferrer"
          >
            privacy policy
          </a>
          , and we see only aggregate counts.
        </p>
      ),
    },
    {
      id: "use-and-sharing",
      title: "Use and sharing",
      body: (
        <p>
          Information is used to operate, secure, maintain, and improve Wireal
          and to provide the workspace features you request. We do not sell
          personal information. Information is shared only with service
          providers needed to operate Wireal, when you direct us to share it, or
          when required by law.
        </p>
      ),
    },
    {
      id: "retention-and-your-choices",
      title: "Retention and your choices",
      body: (
        <p>
          Information is retained while your account is active and as needed to
          operate and protect the service. You can disconnect Google or GitHub
          from Account settings. To request access, correction, or deletion of
          your account and workspace data, contact us. Limited copies may remain
          temporarily in service-provider backups or when retention is required
          for security or legal reasons.
        </p>
      ),
    },
    {
      id: "security-and-updates",
      title: "Security and updates",
      body: (
        <p>
          We use reasonable safeguards designed to protect your information, but
          no online system can guarantee absolute security. We may update this
          policy as Wireal changes and will publish the revised date on this
          page.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>For privacy questions or data requests, email {contactAddress}.</p>
      ),
    },
  ],
};

const terms: PolicyDocument = {
  title: "Terms of Service",
  lead: "Wireal provides tools for organizing projects, tasks, dependencies, repository references, and activity reports.",
  sections: [
    {
      id: "using-wireal",
      title: "Using Wireal",
      body: (
        <p>
          Wireal provides tools for organizing projects, tasks, dependencies,
          repository references, and activity reports. You are responsible for
          your account, the content you add, and maintaining the confidentiality
          of your credentials.
        </p>
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: (
        <p>
          Do not use Wireal to violate applicable law, infringe another
          person&apos;s rights, distribute harmful material, probe or disrupt
          systems, or gain unauthorized access to accounts or data.
        </p>
      ),
    },
    {
      id: "your-content",
      title: "Your content",
      body: (
        <p>
          You retain responsibility for and rights in content you submit. You
          permit Wireal and its service providers to process that content only
          as needed to provide, secure, and maintain the service.
        </p>
      ),
    },
    {
      id: "availability",
      title: "Availability",
      body: (
        <p>
          The service is provided as available and may change, experience
          interruptions, or be discontinued. Access may be limited when needed
          to protect Wireal, its users, or third parties.
        </p>
      ),
    },
    {
      id: "changes-and-contact",
      title: "Changes and contact",
      body: (
        <p>
          We may update these terms and will publish the revised date here. If
          you have questions, contact {contactAddress}.
        </p>
      ),
    },
  ],
};

export const policyDocuments: Record<"privacy" | "terms", PolicyDocument> = {
  privacy,
  terms,
};
