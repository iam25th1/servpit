"use client";

// The reasoning surface. Every named agent's decision and the reason string
// it gave are shown here before the round runs, because that is the visible
// evidence that SERV did the work. Bankroll and its change sit beside them.

import { useEffect, useState } from "react";
import styles from "./agents.module.css";

export interface PlanDecision {
  agentId: string;
  name: string;
  strategy: string;
  address: string;
  link: string | null;
  balanceWei: string;
  enter: boolean;
  stake: number;
  reason: string;
  source: "serv" | "heuristic";
  rejection: string | null;
  model: string | null;
  latencyMs: number | null;
}

export interface PlanResponse {
  roundId: string;
  seed: string;
  network: string;
  backend: string;
  stakeWei: string;
  entrants: number;
  bots: number;
  servCalls: number;
  guardRefusals: number;
  costSummary: string;
  decisions: PlanDecision[];
}

export interface RunTransfer {
  kind: string;
  agentId: string;
  amountWei: string;
  txHash: string | null;
  link: string | null;
  applied: boolean;
}

export interface RunAgent {
  agentId: string;
  balanceBeforeWei: string;
  balanceAfterWei: string;
  entryLink?: string | null;
  payoutLink?: string | null;
}

export interface RunResponse {
  roundId: string;
  winner: string;
  potWei: string;
  rakeWei: string;
  reconciled: boolean;
  transfers: RunTransfer[];
  agents: RunAgent[];
  costSummary: string;
  replay: { characters: unknown[]; log: unknown[]; placements: string[] };
}

const short = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`;

function delta(before: string, after: string): { text: string; up: boolean } {
  const d = BigInt(after) - BigInt(before);
  return { text: `${d >= 0n ? "+" : ""}${d}`, up: d > 0n };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `HTTP ${response.status}`);
  return parsed as T;
}

export function AgentRoster({ seed, entrants, onReplay }: { seed: string; entrants: number; onReplay?: (run: RunResponse) => void }) {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [busy, setBusy] = useState<"plan" | "run" | null>("plan");
  const [error, setError] = useState<string | null>(null);

  // The fetch starts before any state is written, so the effect never sets
  // state synchronously.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await postJson<PlanResponse>("/api/round/plan", { seed, entrants });
        if (cancelled) return;
        setPlan(body);
        setRun(null);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seed, entrants]);

  const loadPlan = async (): Promise<void> => {
    setBusy("plan");
    setError(null);
    setRun(null);
    try {
      setPlan(await postJson<PlanResponse>("/api/round/plan", { seed, entrants }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runRound = async (): Promise<void> => {
    setBusy("run");
    setError(null);
    try {
      const body = await postJson<RunResponse>("/api/round/run", { seed, entrants });
      setRun(body);
      onReplay?.(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const afterFor = (agentId: string): RunAgent | undefined => run?.agents.find((a) => a.agentId === agentId);

  return (
    <section className={styles.panel} aria-label="Agent decisions">
      <div className={styles.head}>
        <h2 className={styles.title}>What the agents decided</h2>
        {plan && (
          <p className={styles.meta}>
            {plan.backend === "cdp" ? plan.network : "local chain"}, allocation {plan.stakeWei} wei, {plan.entrants} seats with {plan.bots} house bots, {plan.servCalls} SERV calls
            {plan.guardRefusals > 0 ? `, ${plan.guardRefusals} guard refusals` : ""}. {plan.costSummary}.
          </p>
        )}
      </div>
      <p className={styles.intro}>
        Each agent is asked once, before the round, whether to commit this period&apos;s allocation from its own balance. The answer below is what it returned. A
        decision is used only after this server re-checks it against the balance the chain reports; anything that fails falls back to the agent&apos;s heuristic and
        says so.
      </p>

      <div className={styles.controls}>
        <button type="button" onClick={() => void loadPlan()} disabled={busy !== null}>
          {busy === "plan" ? "Asking agents" : "Ask again"}
        </button>
        <button type="button" onClick={() => void runRound()} disabled={busy !== null || !plan}>
          {busy === "run" ? "Running round" : "Run round and settle"}
        </button>
        {run && (
          <p className={styles.status} aria-live="polite">
            {run.winner} won {BigInt(run.potWei) - BigInt(run.rakeWei)} of the {run.potWei} pot. Reconciliation {run.reconciled ? "held against chain balances" : "FAILED"}.
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className={styles.grid}>
        {plan?.decisions.map((d) => {
          const after = afterFor(d.agentId);
          const change = after ? delta(after.balanceBeforeWei, after.balanceAfterWei) : null;
          return (
            <article key={d.agentId} className={styles.card}>
              <div className={styles.cardHead}>
                <h3 className={styles.name}>{d.name}</h3>
                <span className={styles.strategy}>{d.strategy}</span>
              </div>
              <p className={styles.verdict}>
                <span className={d.enter ? styles.in : styles.out}>{d.enter ? `Commits ${d.stake}` : "Holds"}</span> from {d.balanceWei} wei
                {change && (
                  <>
                    {" "}
                    <span className={change.up ? styles.up : styles.down}>({change.text} after)</span>
                  </>
                )}
              </p>
              <p className={styles.reason}>{d.reason}</p>
              <div className={styles.foot}>
                <span>{d.source === "serv" ? `${d.model ?? "SERV"}${d.latencyMs ? ` in ${d.latencyMs} ms` : ""}` : "heuristic fallback"}</span>
                {d.link ? (
                  <a href={d.link} target="_blank" rel="noreferrer">
                    {short(d.address)}
                  </a>
                ) : (
                  <span>{short(d.address)}</span>
                )}
                {d.rejection && <span>rejected: {d.rejection}</span>}
              </div>
            </article>
          );
        })}
      </div>

      {run && run.transfers.length > 0 && (
        <table className={styles.ledger}>
          <caption className={styles.meta}>Transfers settled for this round</caption>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Agent</th>
              <th scope="col">Amount, wei</th>
              <th scope="col">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {run.transfers.map((t) => (
              <tr key={`${t.kind}-${t.agentId}`}>
                <td>{t.kind}</td>
                <td>{t.agentId}</td>
                <td>{t.amountWei}</td>
                <td>
                  {t.link ? (
                    <a href={t.link} target="_blank" rel="noreferrer">
                      {t.txHash ? short(t.txHash) : "view"}
                    </a>
                  ) : (
                    <span>{t.txHash ? short(t.txHash) : "pending"}</span>
                  )}
                  {!t.applied && " (already settled)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
