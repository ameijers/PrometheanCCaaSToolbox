# Phone Number Changer — manual

Changes which phone number a voice channel uses: an inbound workstream's channel, an outbound profile or a proactive outbound workstream. See the [README](README.md) for what it reads and writes.

## Before you start

- The new number must already be **set up in Teams and synced into Contact Center** (it's listed under Channels > Phone numbers in the admin center). The tool only changes which channel uses it. For the Teams side, see [the blog post](https://promethean.academy/replacing-a-phone-number-in-a-dynamics-365-contact-center-voice-channel-that-is-bound-to-a-workstream/).
- You need to be allowed to change voice channels in the environment (a system administrator can).
- Calls to a number arrive at its new channel as soon as the change is made. Plan it for a quiet moment.

## 1. Opening the tool

Open **Phone Number Changer** in the app's Site Map. The top bar names the environment it changes. Outside Dataverse (for example when you open the page on its own) it shows a **sample environment** and writes nothing: handy to try it out.

## 2. Finding the channels

The list is grouped: first by kind (**Inbound workstreams**, **Outbound profiles**, **Proactive outbound workstreams**), then by workstream, with each workstream's voice channels under it. An outbound profile is a single row. Each channel shows its number now and, for outbound, its caller ID. On the left: search by channel, workstream or number, filter by kind, **Only channels I'm changing**, and **Show deactivated channels**.

An outbound profile is, under the hood, an outbound workstream with one voice channel; the admin center doesn't show that workstream, the tool does (next to the profile's name).

## 3. Picking new numbers

In **New number**, pick the number the channel should use. The list shows:

- first the channel's current number, marked **(current)**: leave it there to change nothing;
- numbers that are **free** for this direction;
- numbers **now on** another channel of the same direction (named): pick one only if that channel gets another number in the same change;
- numbers that can't be used here (deactivated, or not enabled for inbound or outbound calls), greyed out;
- **No number**, to take the number off the channel.

On an outbound profile, **follows the number** keeps the caller ID the same as the number. Switch it off to keep the current caller ID.

- **Give a channel a new number:** pick it.
- **Move a number** from channel A to channel B: on B pick A's number, and on A pick another number (or No number).
- **Swap two numbers:** on each channel pick the other's number.

**Undo all picks** clears them.

## 4. Checking

The panel on the right lists every change. Rows with a problem turn red and say what's wrong:

- the number is deactivated, or not enabled for the channel's direction;
- the number would be on **two inbound channels**, or used by **two outbound profiles**. A number can be on one inbound channel and one outbound profile, no more: give the other channel another number in the same change.

Warnings (in amber) don't block: a channel left without a number, or a deactivated channel.

## 5. Changing

Click **Change numbers**, read the confirmation (it names the environment) and click **Yes, change**. The tool updates the channels one by one, in a safe order, and then reads them back.

## 6. Result, log and revert

The result lists what changed. Anything that didn't is explained: a failed update, or a change that was skipped because another channel of the same direction still had the number. **Download log** saves a CSV of the run. **Revert this change** puts the previous numbers back on every channel that was changed.

Afterwards, make a test call to each moved number.
