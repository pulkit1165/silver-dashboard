import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import ConnectionStatus from "@/components/ConnectionStatus";

export const dynamic = "force-dynamic";

export default function ConnectionPage() {
  return (
    <>
      <PageHeader
        title="Connection"
        subtitle="Live database status, what we found, and how to go live safely."
      />

      <ConnectionStatus />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="What we confirmed">
          <ul className="space-y-2 text-sm">
            <Li>
              <b>73.149.135.125:8152</b> is an Oracle <b>TCPS (TLS)</b> listener — not plaintext.
            </Li>
            <Li>TLS 1.2 handshake succeeds; self-signed cert <code>CN=DISHA-C2</code>.</Li>
            <Li>One-way TLS — the server does not require a client certificate.</Li>
            <Li>
              The modern &ldquo;thin&rdquo; driver login is <b>reset before any reply</b>, identically
              for every service name — a protocol-level rejection, not a wrong name.
            </Li>
            <Li>
              The original <code>MSDAORA.1</code> provider is thick-mode OCI — pointing to a legacy
              server or an OCI-only listener.
            </Li>
          </ul>
        </Card>

        <Card title="How to go live (read-only)">
          <ol className="space-y-2 text-sm">
            <Li n="1">
              <b>Recommended:</b> run the bundled connector on the machine that already connects
              today (it has the Oracle client + wallet + IP trust). See{" "}
              <code>connector/README.md</code>.
            </Li>
            <Li n="2">
              Or thick-mode on a server: install Oracle Instant Client, set{" "}
              <code>ORACLE_CLIENT_LIB_DIR</code> and <code>ORACLE_CONFIG_DIR</code> (wallet) in{" "}
              <code>.env.local</code>.
            </Li>
            <Li n="3">
              Then fill in <code>lib/queries.ts</code> using the Data Explorer to discover real
              tables. The dashboards switch to live data automatically.
            </Li>
          </ol>
        </Card>
      </div>

      <Card title="Safety" className="mt-4">
        <p className="text-sm text-[var(--muted)]">
          Every database access is read-only by construction: only single <code>SELECT</code>/
          <code>WITH</code> statements are accepted, each runs inside an Oracle{" "}
          <code>SET TRANSACTION READ ONLY</code> block (the database rejects any write with
          ORA-01456), auto-commit is never enabled, and a statement timeout plus row cap protect the
          server. No DDL or DML is ever issued.
        </p>
      </Card>
    </>
  );
}

function Li({ children, n }: { children: React.ReactNode; n?: string }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 text-[var(--accent)]">{n ?? "•"}</span>
      <span>{children}</span>
    </li>
  );
}
