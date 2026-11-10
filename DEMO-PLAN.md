# Demo video plan — SplitBill AI (target 2:30, hard limit 3:00)

Rules: under 3 minutes (judges aren't required to watch past 3:00),
public on YouTube, must show the project functioning on the device it
was built for (a desktop/laptop browser), no third-party trademarks or
copyrighted music.

**Recording route (no login wall):** the app runs on `localhost:3000`,
so the whole demo can be screen-recorded on the build machine
(Chrome + ffmpeg) without any account sign-in — except the optional
real-sandbox scene, which needs the sandbox credentials step done
first (see STATUS.md) and a sandbox *personal* test account to pay
with (created in the same developer dashboard, 2 extra minutes).

## Shot list

| Time | Screen | Narration / caption |
|---|---|---|
| 0:00–0:15 | Title card over the app home | "Dinner's over. Now the worst part: the bill. SplitBill AI ends it in three clicks." |
| 0:15–0:45 | Paste the sample bill (prefilled), click **Analyze & split with AI**; the item table appears; point at the source badge ("AI (model)") | "Paste the receipt. The AI reads every line — items, quantities, tax, tip — no typing." |
| 0:45–1:15 | Untick Budi on the pizza row; untick Bayu+Ana on a personal item; show totals recomputing; zoom the summary bar ($70.11 preserved) | "Assign who had what. Tax and tip follow proportionally — and the total never loses a cent." |
| 1:15–1:55 | Click Ana's PayPal button → (real sandbox checkout popup: log in with sandbox personal account, approve) → card flips PAID ✓ with capture id; summary bar updates | "Each person pays exactly their share — a real PayPal Sandbox order, created and captured through the Orders API." |
| 1:55–2:15 | Pay a second share quickly; show 2 of 3 collected | "The organizer watches collection live — who paid, who hasn't." |
| 2:15–2:30 | End card: name, one-liner, repo URL | "SplitBill AI — paste a bill, AI splits it, PayPal settles it." |

## Variants

- **If sandbox credentials are not ready at recording time:** shoot
  scene 4 with the demo-mode button, keeping the demo banner visible
  and captioning honestly: "Shown in demo mode — the same flow runs
  the real PayPal Sandbox checkout once sandbox app credentials are
  configured (5-minute setup in the README)." Never caption it as a
  real payment.
- **Indonesian receipt bonus shot (optional, +15s):** swap in the
  Warung receipt (`Nasi Goreng 45.000` …) to show IDR parsing; only
  if the runtime stays under 2:45.

## Checklist before upload

- [ ] Fresh server start; browser zoom 110–125% so text is legible
- [ ] No real credentials, keys, or personal data on screen
      (sandbox test-account email is fine — it's a PayPal fixture)
- [ ] Runtime ≤ 2:55; public visibility; title:
      "SplitBill AI — AI bill splitting with PayPal Sandbox checkout (PayPal AI Hackathon)"
