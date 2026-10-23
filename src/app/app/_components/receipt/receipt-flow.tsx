"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ButtonLink, Empty, Field, Loading, Notice, PageIntro, Section, TextareaField } from "@/app/_ui";

import { prepareReceiptImage } from "../../_lib/image";
import {
  draftFromInterpretation,
  emptyDraft,
  type DraftParticipant,
  type InterpretResponse,
  type ReceiptDraft,
} from "../../_lib/receipt-draft";
import { ConfirmScreen } from "./confirm";
import { ItemEditor } from "./item-editor";

export interface ReceiptFlowProps {
  readonly hostId: string;
  readonly hostName: string;
  readonly friends: ReadonlyArray<{ id: string; name: string }>;
}

type Step = { kind: "participants" } | { kind: "mode" } | { kind: "llm" } | { kind: "manual" } | { kind: "confirm" };

const CHIP =
  "motion inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border px-5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

export function ReceiptFlow({ hostId, hostName, friends }: ReceiptFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "participants" });
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);

  const participants: DraftParticipant[] = [
    { id: hostId, name: hostName, isHost: true },
    ...friends.filter((f) => selected.includes(f.id)).map((f) => ({ id: f.id, name: f.name, isHost: false })),
  ];

  if (step.kind === "participants") {
    return (
      <div className="space-y-16">
        <PageIntro label="Log a receipt" title="Who was there?">
          You are always included as the host. Pick everyone who shared the bill.
        </PageIntro>
        {friends.length === 0 ? (
          <Empty action={<ButtonLink href="/app/friends" variant="secondary">Add friends</ButtonLink>}>
            Add a friend first so there is someone to split with.
          </Empty>
        ) : (
          <fieldset className="space-y-6">
            <legend className="label">Participants</legend>
            <div className="flex flex-wrap gap-3">
              <span className={`${CHIP} cursor-default border-ink bg-ink text-paper`}>{hostName} (you, host)</span>
              {friends.map((f) => {
                const on = selected.includes(f.id);
                return (
                  <label key={f.id} className={`${CHIP} ${on ? "border-ink bg-ink text-paper" : "border-line text-ink"}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => setSelected(on ? selected.filter((id) => id !== f.id) : [...selected, f.id])}
                    />
                    {f.name}
                  </label>
                );
              })}
            </div>
            <Button type="button" onClick={() => setStep({ kind: "mode" })} disabled={selected.length === 0}>
              Continue
            </Button>
            {selected.length === 0 ? <p className="text-sm text-ink-mute">Pick at least one friend.</p> : null}
          </fieldset>
        )}
      </div>
    );
  }

  if (step.kind === "mode") {
    return (
      <div className="space-y-16">
        <PageIntro label="Log a receipt" title="How do you want to enter it?">
          Splitting with {participants.length - 1 === 1 ? participants[1].name : `${participants.length - 1} friends`}. Either way you
          review and confirm before anything is saved.
        </PageIntro>
        <div className="grid gap-6 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setStep({ kind: "llm" })}
            className="motion rounded-xl border border-line bg-paper-raised p-6 text-left hover:border-ink"
          >
            <span className="heading block">From a photo or text →</span>
            <span className="mt-3 block text-ink-soft">Snap the receipt and add a note like “Sarah skipped the drinks”. An assistant drafts the split for you to check.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(emptyDraft(participants, "manual"));
              setStep({ kind: "manual" });
            }}
            className="motion rounded-xl border border-line bg-paper-raised p-6 text-left hover:border-ink"
          >
            <span className="heading block">Enter items by hand →</span>
            <span className="mt-3 block text-ink-soft">Type each line, tick who shared it, choose the charges. No assistant involved.</span>
          </button>
        </div>
        <Button type="button" variant="tertiary" onClick={() => setStep({ kind: "participants" })}>
          Back
        </Button>
      </div>
    );
  }

  if (step.kind === "llm") {
    return (
      <LlmMode
        participants={participants}
        onBack={() => setStep({ kind: "mode" })}
        onManual={() => {
          setDraft(emptyDraft(participants, "manual"));
          setStep({ kind: "manual" });
        }}
        onProposal={(next) => {
          setDraft(next);
          setStep({ kind: "confirm" });
        }}
      />
    );
  }

  if (step.kind === "manual" && draft) {
    return (
      <div className="space-y-16">
        <PageIntro label="Log a receipt" title="Enter the receipt">
          Prices as printed per line; charges are added on top according to your choice.
        </PageIntro>
        <ItemEditor draft={draft} onChange={setDraft} />
        <div className="flex flex-wrap items-center gap-6">
          <Button type="button" onClick={() => setStep({ kind: "confirm" })} disabled={draft.items.length === 0}>
            Review split
          </Button>
          <Button type="button" variant="tertiary" onClick={() => setStep({ kind: "mode" })}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (step.kind === "confirm" && draft) {
    return (
      <div className="space-y-16">
        <PageIntro label="Log a receipt" title="Confirm the split">
          Nothing is saved until you confirm. Amounts are computed, never typed.
        </PageIntro>
        <ConfirmScreen
          draft={draft}
          hostId={hostId}
          onChange={setDraft}
          onBack={() => setStep({ kind: draft.source === "llm" ? "llm" : "manual" })}
          onSaved={() => {
            router.push("/app?saved=1");
            router.refresh();
          }}
        />
      </div>
    );
  }

  return <Loading />;
}

interface LlmModeProps {
  readonly participants: readonly DraftParticipant[];
  readonly onBack: () => void;
  readonly onManual: () => void;
  readonly onProposal: (draft: ReceiptDraft) => void;
}

interface ApiError {
  readonly code: string;
  readonly message: string;
}

function LlmMode({ participants, onBack, onManual, onProposal }: LlmModeProps) {
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [receiptText, setReceiptText] = useState("");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"image" | "interpret" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("image");
    setError(null);
    try {
      setImage(await prepareReceiptImage(file));
      setImageName(file.name);
    } catch (e) {
      setError({ code: "image", message: e instanceof Error ? e.message : "Could not read the photo." });
    } finally {
      setBusy(null);
    }
  };

  const ready = (image !== null || receiptText.trim().length > 0) && busy === null;

  const interpret = async () => {
    setBusy("interpret");
    setError(null);
    try {
      const res = await fetch("/api/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(image ? { image } : {}),
          ...(receiptText.trim() ? { receiptText: receiptText.trim() } : {}),
          note,
          participants: participants.map((p) => ({ id: p.id, name: p.name })),
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (body as { error?: ApiError } | null)?.error;
        setError(err ?? { code: `http_${res.status}`, message: "The assistant did not answer." });
        return;
      }
      onProposal(draftFromInterpretation(body as InterpretResponse, participants, title.trim()));
    } catch {
      setError({ code: "network", message: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(null);
    }
  };

  const unavailable = error !== null && (error.code === "llm_unavailable" || error.code === "llm_request_failed" || error.code === "http_503");

  return (
    <div className="space-y-16">
      <PageIntro label="Log a receipt" title="Photo or text">
        Add the receipt and anything the assistant should know. You will check every line before it is saved.
      </PageIntro>

      <Section title="Receipt">
        <div className="space-y-2">
          <label htmlFor="receipt-photo" className="label block">
            Photo (take one or upload)
          </label>
          <input
            id="receipt-photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="block w-full text-ink file:mr-4 file:min-h-12 file:rounded-full file:border file:border-line file:bg-transparent file:px-5 file:text-ink"
            onChange={(e) => void onFile(e.target.files?.[0])}
            disabled={busy !== null}
          />
          {busy === "image" ? <Loading>Preparing photo…</Loading> : null}
          {image ? (
            <p className="text-sm text-ink-soft">
              Ready: {imageName} (resized to fit).{" "}
              <button type="button" className="underline underline-offset-4" onClick={() => { setImage(null); setImageName(null); }}>
                Remove
              </button>
            </p>
          ) : null}
        </div>
        <TextareaField
          label="Or paste the receipt text"
          id="receipt-text"
          rows={6}
          value={receiptText}
          onChange={(e) => setReceiptText(e.target.value)}
          placeholder={"Chicken rice 5.50\nIced tea 2.00\n..."}
        />
      </Section>

      <Section title="Note for the assistant">
        <TextareaField
          label="What should it know? (optional)"
          id="receipt-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Sarah skipped the drinks; it's Ben's birthday so he pays nothing"
          maxLength={4000}
        />
        <Field label="Title (optional)" id="llm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday dinner" maxLength={120} />
      </Section>

      {error ? (
        <Notice role="alert">
          {unavailable ? "The assistant is unavailable right now." : error.message}{" "}
          {unavailable ? (
            <button type="button" className="underline underline-offset-4" onClick={onManual}>
              Enter the items by hand instead
            </button>
          ) : null}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-6">
        <Button type="button" onClick={() => void interpret()} disabled={!ready}>
          {busy === "interpret" ? "Reading the receipt…" : "Draft the split"}
        </Button>
        <Button type="button" variant="tertiary" onClick={onBack} disabled={busy !== null}>
          Back
        </Button>
      </div>
      {!ready && busy === null ? <p className="text-sm text-ink-mute">Add a photo or paste the receipt text first.</p> : null}
    </div>
  );
}
