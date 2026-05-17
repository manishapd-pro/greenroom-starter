import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  AlertTriangle,
  Mail,
  Pencil,
  XCircle,
  Wallet,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { getShowById } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Field,
} from "@/components/ui/card";
import { StatusBadge, DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import { calculateSettlement } from "@/lib/dealMath";
import { formatMoney, formatShowDateFull } from "@/lib/format";
import type { Settlement, Recoup } from "@/db/schema";
import { Logomark } from "@/components/brand/logo";
import type {
  AuditStep as CalcAuditStep,
  BonusEval as CalcBonusEval,
} from "@/lib/dealMath";

const RECOUP_LABELS: Record<Recoup["category"], string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

export default async function SettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist, deal, ticketSales, expenses, settlement, recoups } =
    data;

  if (!deal) {
    return (
      <div className="px-12 py-10 max-w-4xl">
        <BackLink showId={show.id} />
        <div className="text-[13px] text-ink-400">
          No deal entered for this show. Settlement can&apos;t run yet.
        </div>
      </div>
    );
  }

  const calc = calculateSettlement({
    deal,
    ticketSales,
    expenses,
    venueCapacity: data.venue?.capacity ?? undefined,
  });

  const disputedRecoups = recoups.filter((r) => r.status === "disputed");
  const isDisputed =
    settlement?.status === "disputed" ||
    settlement?.status === "revised" ||
    !!settlement?.disputedAt;
  const disputedRecoupValue = disputedRecoups.reduce(
    (s, r) => s + r.amount,
    0
  );

  return (
    <div
      className={`px-12 py-10 max-w-7xl ${
        isDisputed
          ? "bg-gradient-to-b from-rose-50/30 via-canvas to-canvas"
          : ""
      }`}
    >
      <BackLink showId={show.id} />

      <div className="mb-16">
        <div className="flex items-center gap-1.5 mb-4">
          <StatusBadge status={show.status} />
          <DealTypeBadge type={deal.dealType} />
          {calc.supported &&
            (calc as { flavor?: string }).flavor &&
            (calc as { flavor?: string }).flavor !== "standard" && (
              <PlainBadge variant="sky">
                {(calc as { flavor?: string }).flavor}
              </PlainBadge>
            )}
          {settlement?.status === "disputed" && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-medium ring-1 ring-inset bg-rose-50 text-rose-800 ring-rose-200/80">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
              </span>
              Disputed
            </span>
          )}
        </div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Settlement · {artist?.name}
        </h1>
        <div className="text-[14px] text-ink-400 mt-3">
          {formatShowDateFull(show.date)}
        </div>
      </div>

      {isDisputed && disputedRecoupValue > 0 && (
        <div className="mb-8 rounded-lg border border-rose-200/60 bg-rose-50/40 p-5 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-rose-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-rose-800">
              {disputedRecoups.length} recoup
              {disputedRecoups.length === 1 ? "" : "s"} in dispute ·{" "}
              {formatMoney(disputedRecoupValue)} contested
            </div>
            <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">
              The artist team has flagged recoup line items. This settlement
              cannot be finalized until the dispute is resolved.
            </p>
          </div>
        </div>
      )}

      {settlement && (
        <LifecycleBar
          settlement={settlement}
          disputedRecoups={disputedRecoups.length}
        />
      )}

      <div className="space-y-6 mt-6">
        {calc.supported ? (
          <SupportedSettlement
            calc={
              calc as Extract<
                ReturnType<typeof calculateSettlement>,
                { supported: true }
              >
            }
            existingSettlement={settlement}
            deal={deal}
          />
        ) : (
          <UnsupportedDeal
            calc={
              calc as Extract<
                ReturnType<typeof calculateSettlement>,
                { supported: false }
              >
            }
            deal={deal}
            existingSettlement={settlement}
            grossSoFar={ticketSales.reduce((s, t) => s + t.gross, 0)}
            totalFees={ticketSales.reduce((s, t) => s + t.fees, 0)}
            totalExpenses={expenses
              .filter((e) => !e.absorbedByVenue)
              .reduce((s, e) => s + e.amount, 0)}
            ticketCount={ticketSales.reduce((s, t) => s + (t.qty ?? 0), 0)}
            expenseRowCount={expenses.length}
          />
        )}

        {recoups.length > 0 && <RecoupsSection recoups={recoups} />}

        {settlement && (settlement.signoffText || settlement.notes) && (
          <SignoffSection settlement={settlement} />
        )}
      </div>

      <div className="mt-16 pt-10 border-t border-ink-200/60">
        <div className="flex gap-4 items-start max-w-3xl">
          <Logomark size={40} className="shrink-0" />
          <div>
            <h2
              className="font-display text-[20px] font-medium text-ink-900 mb-2"
              style={{ letterSpacing: "-0.02em" }}
            >
              Every number, every decision — shown.
            </h2>
            <p className="text-[13px] text-ink-500 leading-relaxed">
              The audit trail above is the complete settlement worksheet.
              Guarantee vs percentage comparison, expense caps, bonus
              evaluations — every input is visible so the artist&apos;s team
              can follow the math and sign with confidence.{" "}
              <Link
                href="/context"
                className="text-brand-700 font-medium hover:text-brand-800 hover:underline inline-flex items-center gap-0.5"
              >
                About this prototype <ArrowRight className="h-3 w-3" />
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackLink({ showId }: { showId: string }) {
  return (
    <Link
      href={`/shows/${showId}`}
      className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to show
    </Link>
  );
}

function SupportedSettlement({
  calc,
  existingSettlement,
  deal,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: true }>;
  existingSettlement: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["settlement"];
  deal: NonNullable<Awaited<ReturnType<typeof getShowById>>>["deal"];
}) {
  const isVs = calc.dealType === "vs";
  const hasGap =
    existingSettlement?.totalToArtist != null &&
    Math.abs(existingSettlement.totalToArtist - calc.totalToArtist) > 0.5;

  return (
    <>
      <div className="text-center py-10 mb-2">
        <div className="eyebrow text-[10px] text-ink-400 mb-3">
          Total to artist
        </div>
        <div
          className="text-[72px] font-mono tabular font-bold text-ink-900 leading-none"
          style={{ letterSpacing: "-0.03em" }}
        >
          {formatMoney(calc.totalToArtist)}
        </div>
        {existingSettlement && (
          <div className="mt-3">
            {existingSettlement.status === "paid" ? (
              <PlainBadge variant="brand">Paid</PlainBadge>
            ) : existingSettlement.status === "signed" ||
              existingSettlement.status === "finalized" ? (
              <PlainBadge variant="brand">Signed</PlainBadge>
            ) : existingSettlement.status === "disputed" ? (
              <PlainBadge variant="rose">Disputed</PlainBadge>
            ) : null}
          </div>
        )}
      </div>

      {hasGap && existingSettlement?.totalToArtist != null && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-5 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-amber-900 mb-1">
              {formatMoney(
                Math.abs(
                  existingSettlement.totalToArtist - calc.totalToArtist
                )
              )}{" "}
              gap between calculated and recorded
            </div>
            <p className="text-[12.5px] text-ink-700 leading-relaxed">
              This engine calculates{" "}
              <span className="font-mono font-semibold">
                {formatMoney(calc.totalToArtist)}
              </span>{" "}
              from the structured deal terms. Greenroom recorded{" "}
              <span className="font-mono font-semibold">
                {formatMoney(existingSettlement.totalToArtist)}
              </span>{" "}
              — settled off-platform via spreadsheet. The gap typically reflects
              a manual concession, a disputed recoup, or a renegotiation that
              happened outside the system and was never reconciled back.
            </p>
          </div>
        </div>
      )}

      {isVs && calc.vsGuarantee != null && (
        <VsComparisonPanel calc={calc} />
      )}

      <InputsCard calc={calc} deal={deal} />
      <AuditTrailCard calc={calc} />

      {calc.bonusesNotTriggered.length > 0 && (
        <BonusesNotTriggeredCard bonuses={calc.bonusesNotTriggered} />
      )}
    </>
  );
}

function VsComparisonPanel({
  calc,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: true }>;
}) {
  if (
    calc.vsGuarantee == null ||
    calc.vsPercentagePayout == null ||
    calc.vsWinner == null
  )
    return null;

  const guaranteeWins = calc.vsWinner === "guarantee";
  const pctWins = calc.vsWinner === "percentage";

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Guarantee vs percentage</CardTitle>
          <CardDescription>
            Artist receives whichever is greater.
          </CardDescription>
        </div>
        <PlainBadge variant={pctWins ? "brand" : "amber"}>
          {pctWins ? "Percentage wins" : "Guarantee wins"}
        </PlainBadge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div
            className={`rounded-lg p-5 ${
              guaranteeWins
                ? "ring-2 ring-brand-500 bg-brand-50/30"
                : "ring-1 ring-ink-200/60 bg-white"
            }`}
          >
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Guarantee floor
            </div>
            <div className="text-[28px] font-mono tabular font-semibold text-ink-900 leading-none">
              {formatMoney(calc.vsGuarantee)}
            </div>
            {guaranteeWins && (
              <div className="flex items-center gap-1 mt-2 text-[11px] text-brand-700 font-medium">
                <Check className="h-3 w-3" />
                Applied
              </div>
            )}
          </div>
          <div
            className={`rounded-lg p-5 ${
              pctWins
                ? "ring-2 ring-brand-500 bg-brand-50/30"
                : "ring-1 ring-ink-200/60 bg-white"
            }`}
          >
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Percentage payout
            </div>
            <div className="text-[28px] font-mono tabular font-semibold text-ink-900 leading-none">
              {formatMoney(calc.vsPercentagePayout)}
            </div>
            {pctWins && (
              <div className="flex items-center gap-1 mt-2 text-[11px] text-brand-700 font-medium">
                <Check className="h-3 w-3" />
                Applied
              </div>
            )}
          </div>
        </div>
        {guaranteeWins && (
          <div className="mt-4 rounded-lg bg-amber-50/50 ring-1 ring-amber-200/60 px-4 py-3 text-[12.5px] text-ink-700 leading-relaxed">
            Ticket performance ({formatMoney(calc.vsPercentagePayout)}) did not
            exceed the guarantee floor. The artist receives the guaranteed
            minimum.
          </div>
        )}
        {pctWins && (
          <div className="mt-4 rounded-lg bg-brand-50/50 ring-1 ring-brand-200/60 px-4 py-3 text-[12.5px] text-ink-700 leading-relaxed">
            Ticket performance exceeded the guarantee — the artist earns{" "}
            {formatMoney(calc.vsPercentagePayout - calc.vsGuarantee)} above the
            floor.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InputsCard({
  calc,
  deal,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: true }>;
  deal: NonNullable<Awaited<ReturnType<typeof getShowById>>>["deal"];
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Inputs used in this calculation</CardTitle>
          <CardDescription>
            Every number the settlement engine read.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field
            label="Gross box office"
            mono
            value={formatMoney(calc.grossBoxOffice)}
          />
          <Field
            label="Ticketing fees"
            mono
            value={formatMoney(calc.totalFees)}
          />
          <Field
            label="Net box office"
            mono
            value={formatMoney(calc.netBoxOffice)}
          />
          <Field
            label="Expenses (passed through)"
            mono
            value={formatMoney(calc.totalExpenses)}
          />
          {calc.expenseCap != null && (
            <Field
              label="Expense cap"
              mono
              value={formatMoney(calc.expenseCap)}
            />
          )}
          {calc.cappedExpenses !== calc.totalExpenses && (
            <Field
              label="Expenses after cap"
              mono
              value={formatMoney(calc.cappedExpenses)}
            />
          )}
        </div>

        {deal?.dealNotesFreetext && (
          <div className="mt-5 pt-5 border-t border-ink-100/80">
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Deal notes (what Mariana trusts)
            </div>
            <div
              className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed"
              style={{ fontStyle: "italic" }}
            >
              {deal.dealNotesFreetext}
            </div>
            <div className="mt-2 text-[11px] text-ink-400 leading-snug">
              Note: the calculation uses structured fields. If the prose
              differs, the prose is the authoritative deal.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditTrailCard({
  calc,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: true }>;
}) {
  return (
    <Card accent="brand">
      <CardHeader>
        <div>
          <CardTitle>Settlement worksheet — full audit trail</CardTitle>
          <CardDescription className="font-mono text-[11px]">
            {calc.finalFormula}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80 px-0">
        {calc.steps.map((step, i) => (
          <AuditRow key={i} step={step} />
        ))}
      </CardContent>
    </Card>
  );
}

function AuditRow({ step }: { step: CalcAuditStep }) {
  const isTotal = step.label === "Total to artist";
  const isWinner =
    step.label.startsWith("▲") || step.label.startsWith("▼");
  const label = step.label.replace(/^[▲▼] /, "");

  return (
    <div
      className={`flex items-start justify-between gap-4 px-5 py-3 ${
        isTotal
          ? "bg-brand-50/20"
          : isWinner
          ? step.label.startsWith("▲")
            ? "bg-brand-50/10"
            : "bg-amber-50/20"
          : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`text-[13px] leading-tight flex items-center gap-1.5 ${
            isTotal
              ? "font-semibold text-ink-900"
              : step.isSubtotal
              ? "font-medium text-ink-800"
              : step.isDeduction
              ? "text-ink-500"
              : "text-ink-700"
          }`}
        >
          {step.isDeduction && (
            <span className="text-rose-500 text-[10px] font-mono">−</span>
          )}
          {isWinner && (
            <>
              {step.label.startsWith("▲") ? (
                <TrendingUp className="h-3.5 w-3.5 text-brand-700 shrink-0" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-amber-700 shrink-0" />
              )}
            </>
          )}
          {label}
        </div>
        {step.note && (
          <div className="text-[11px] text-ink-400 mt-0.5 leading-snug max-w-lg">
            {step.note}
          </div>
        )}
      </div>
      <div
        className={`text-[14px] font-mono tabular shrink-0 ${
          isTotal
            ? "font-bold text-ink-900 text-[18px]"
            : step.isSubtotal
            ? "font-semibold text-ink-900"
            : step.isDeduction
            ? "text-rose-600"
            : step.value === 0
            ? "text-ink-300"
            : "text-ink-800"
        }`}
      >
        {step.isDeduction
          ? `(${formatMoney(Math.abs(step.value))})`
          : formatMoney(step.value)}
      </div>
    </div>
  );
}

function BonusesNotTriggeredCard({ bonuses }: { bonuses: CalcBonusEval[] }) {
  const realBonuses = bonuses.filter((b) => b.amount > 0);
  if (realBonuses.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bonuses evaluated — not triggered</CardTitle>
        <CardDescription>
          Structured bonuses on this deal that didn&apos;t hit. Shown for
          transparency — useful when the agent asks about thresholds.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80">
        {realBonuses.map((b, i) => (
          <div key={i} className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] text-ink-600">{b.label}</div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">
                {b.reason}
              </div>
            </div>
            <div className="text-[12.5px] text-ink-300 font-mono tabular line-through shrink-0">
              {formatMoney(b.amount)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function UnsupportedDeal({
  calc,
  deal,
  existingSettlement,
  grossSoFar,
  totalFees,
  totalExpenses,
  ticketCount,
  expenseRowCount,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: false }>;
  deal: NonNullable<Awaited<ReturnType<typeof getShowById>>>["deal"];
  existingSettlement: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["settlement"];
  grossSoFar: number;
  totalFees: number;
  totalExpenses: number;
  ticketCount: number;
  expenseRowCount: number;
}) {
  return (
    <>
      <Card accent="amber">
        <CardContent className="py-12 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-200/80 mb-5">
            <Info className="h-5 w-5 text-amber-700" />
          </div>
          <h2
            className="font-display text-[22px] font-medium text-ink-900 mb-2"
            style={{ letterSpacing: "-0.02em" }}
          >
            Cannot settle this deal automatically
          </h2>
          <p className="text-[13px] text-ink-500 max-w-md mx-auto leading-relaxed">
            {calc.reason}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What the system has</CardTitle>
            <CardDescription>
              Inputs available if you need to calculate manually.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field
              label="Gross box office"
              mono
              value={formatMoney(grossSoFar)}
            />
            <Field label="Fees" mono value={formatMoney(totalFees)} />
            <Field
              label="Net box office"
              mono
              value={formatMoney(grossSoFar - totalFees)}
            />
          </div>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field label="Tickets sold" mono value={String(ticketCount)} />
            <Field
              label="Expenses (line items)"
              mono
              value={String(expenseRowCount)}
            />
            <Field
              label="Expenses (passed through)"
              mono
              value={formatMoney(totalExpenses)}
            />
          </div>
          {deal?.dealNotesFreetext && (
            <div className="mt-6">
              <div className="eyebrow text-[10px] text-ink-500 mb-2">
                Deal notes (free text — what Mariana actually trusts)
              </div>
              <div className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
                {deal.dealNotesFreetext}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {existingSettlement?.totalToArtist != null && (
        <Card
          accent={existingSettlement.status === "disputed" ? "rose" : "brand"}
        >
          <CardHeader>
            <div>
              <CardTitle>Actually settled (off-platform)</CardTitle>
              <CardDescription>
                The result logged back into Greenroom after a manual
                calculation.
              </CardDescription>
            </div>
            {existingSettlement.status === "disputed" ? (
              <PlainBadge variant="rose">Disputed</PlainBadge>
            ) : (
              <PlainBadge variant="brand">Signed</PlainBadge>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between py-2">
              <span className="text-[13px] text-ink-600">Total to artist</span>
              <span
                className="text-[32px] font-mono tabular font-semibold text-ink-900"
                style={{ letterSpacing: "-0.02em" }}
              >
                {formatMoney(existingSettlement.totalToArtist)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function RecoupsSection({ recoups }: { recoups: Recoup[] }) {
  const total = recoups.reduce((s, r) => s + r.amount, 0);
  const disputedTotal = recoups
    .filter((r) => r.status === "disputed")
    .reduce((s, r) => s + r.amount, 0);
  const hasDisputed = disputedTotal > 0;

  return (
    <Card accent={hasDisputed ? "rose" : undefined}>
      <CardHeader>
        <div>
          <CardTitle>Recoups</CardTitle>
          <CardDescription>
            Venue costs taken off the top before artist payment. Often the
            disputed line items in a settlement.
          </CardDescription>
        </div>
        <PlainBadge variant={hasDisputed ? "rose" : "default"}>
          {formatMoney(total)} total
        </PlainBadge>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80">
        {recoups.map((r) => (
          <div
            key={r.id}
            className="py-3.5 grid grid-cols-[1fr_auto_auto] items-center gap-3"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-ink-900 leading-tight">
                {r.label}
              </div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">
                {RECOUP_LABELS[r.category]}
              </div>
            </div>
            <div>
              {r.status === "disputed" ? (
                <PlainBadge variant="rose">Disputed</PlainBadge>
              ) : r.status === "withdrawn" ? (
                <PlainBadge variant="default">Withdrawn</PlainBadge>
              ) : (
                <PlainBadge variant="brand">Agreed</PlainBadge>
              )}
            </div>
            <div className="text-[13.5px] font-mono tabular text-ink-900 text-right min-w-[80px]">
              {formatMoney(r.amount)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SignoffSection({ settlement }: { settlement: Settlement }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-off & notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {settlement.signoffText && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              From the artist team
            </div>
            <div className="text-[13px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
              &ldquo;{settlement.signoffText}&rdquo;
            </div>
          </div>
        )}
        {settlement.notes && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Mariana&apos;s settlement notes
            </div>
            <div className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
              {settlement.notes}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Stage = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  timestamp?: Date | null;
};

function LifecycleBar({
  settlement,
  disputedRecoups,
}: {
  settlement: Settlement;
  disputedRecoups: number;
}) {
  if (settlement.status === "voided") {
    return (
      <div className="rounded-lg border border-ink-200/80 bg-white px-5 py-4 flex items-center gap-3">
        <XCircle className="h-4 w-4 text-ink-400" />
        <div>
          <div className="text-[13px] font-medium text-ink-900">
            Settlement voided
          </div>
          <div className="text-[11.5px] text-ink-400 mt-0.5">
            The show was cancelled or the settlement was scrapped.
          </div>
        </div>
      </div>
    );
  }

  const stages: Stage[] = [
    { key: "draft", label: "Drafted", icon: Pencil, timestamp: settlement.draftedAt },
    { key: "submitted", label: "Submitted", icon: Mail, timestamp: settlement.submittedAt },
    { key: "review", label: "Reviewed", icon: ChevronRight, timestamp: settlement.reviewStartedAt },
    {
      key: "signed",
      label: settlement.disputedAt ? "Finalized" : "Signed",
      icon: Check,
      timestamp: settlement.finalizedAt ?? settlement.signedAt,
    },
    { key: "paid", label: "Paid", icon: Wallet, timestamp: settlement.paidAt },
  ];

  const currentIndex = (() => {
    switch (settlement.status) {
      case "draft": return 0;
      case "submitted": return 1;
      case "in_review": return 2;
      case "disputed":
      case "signed":
      case "revised":
      case "finalized": return 3;
      case "paid": return 4;
      default: return 0;
    }
  })();

  const isDisputed =
    settlement.status === "disputed" ||
    settlement.status === "revised" ||
    !!settlement.disputedAt;

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="eyebrow text-[10px] text-ink-400">
            Settlement lifecycle
          </div>
          {isDisputed && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700">
              <AlertTriangle className="h-3 w-3" />
              {settlement.status === "disputed"
                ? "In dispute"
                : settlement.status === "revised"
                ? "Revision sent"
                : "Resolved after dispute"}
              {disputedRecoups > 0 && (
                <span className="text-rose-600">
                  · {disputedRecoups} disputed recoup
                  {disputedRecoups === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-1 relative">
          <div className="absolute top-3.5 left-[10%] right-[10%] h-px bg-ink-200/60" />
          {stages.map((stage, i) => {
            const isComplete = i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = i > currentIndex;
            const Icon = stage.icon;
            const stageDot = isComplete
              ? "bg-brand-700 ring-brand-700 text-white"
              : isCurrent
              ? isDisputed
                ? "bg-rose-50 ring-rose-500 text-rose-700"
                : "bg-brand-50 ring-brand-700 text-brand-700"
              : "bg-white ring-ink-200/80 text-ink-300";

            return (
              <div key={stage.key} className="flex flex-col items-center text-center">
                <div className={`relative z-10 w-7 h-7 rounded-full ring-2 flex items-center justify-center ${stageDot}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className={`mt-2.5 text-[11px] font-medium leading-tight ${isFuture ? "text-ink-300" : "text-ink-900"}`}>
                  {stage.label}
                </div>
                <div className="text-[10px] text-ink-400 mt-0.5 font-mono tabular leading-tight min-h-[12px]">
                  {stage.timestamp
                    ? new Date(stage.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : ""}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
