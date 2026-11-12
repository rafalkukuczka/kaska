# Manual interaction campaigns

Manual interaction campaigns are authored in Katie and run from the **Manual interaction** tab in the Katie Outreach Chrome extension. Katie stores a per-domain scenario; the extension runs its validated action plan on either the current matching tab or a managed tab opened at the scenario start URL.

## Configure a campaign

1. Create or edit a campaign and choose **Manual interaction · rozszerzenie Katie Outreach** as its channel.
2. Add a scenario for every site structure used by the campaign. Enter the exact domain, an HTTPS starting URL, and plain-language instructions.
3. Use **Zbuduj kroki z AI**, review the generated JSON action plan and its equivalent JavaScript preview, and correct selectors for that site. To submit a LinkedIn search with Enter, use `fill` followed by `pressEnter` with the same search input selector.
4. Add the scenario. Repeat for other domains, then save the campaign.
5. Prepare the campaign tasks, review them, and activate the queue.
6. In Katie Outreach, open **Manual interaction**, choose a task and scenario, then run it on the active tab or in a managed tab.

Choose **Agent AI** instead of **Zapisane kroki** to run from the scenario description. The agent sends visible control labels, short page context and the contact's name, company and role to the configured AI integration. The extension inserts prepared subject and body values locally. The simulation stops before sending. For a live send, the agent requires an explicit sending instruction, the matching recipient and the prepared message in the open composer. Agent runs are limited to 25 decisions.

The scenario editor lists the supported variables. Contact data includes `{{contact_name}}` (also `{{name}}`), `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{company}}`, `{{role}}`, `{{notes}}`, `{{tags}}`, and `{{target_group}}`. The first word of the full name supplies `{{first_name}}` and the rest supplies `{{last_name}}`.

The optional `text` field in `waitFor` and `click` matches a visible label inside the selected element. For LinkedIn profile links selected by `[href*="/in/"]` in search results or suggestions, the extension defaults to `{{contact_name}}`. When several profiles share the name, it compares the visible result rows by exact company match, matching campaign audience tags, word overlap with the campaign audience description and tags, and role match, in that order. The run stops if the top profiles still tie.

The LinkedIn search query uses `{{contact_name}} {{company}}`. The extension adds the contact's company to existing name-only steps that fill the LinkedIn search field, when a company is available. The result label still matches the contact name.

The simulation follows a tab opened by the scenario and waits for Chrome to report that it has loaded. If the last click leaves the page in place without a navigation event, the simulation keeps observing the tab. Use **Zakończ obserwację** in the extension panel to finish.

Campaign and message data includes `{{campaign_name}}`, `{{offer}}`, `{{audience}}` (the audience description), `{{audience_tags}}` (the campaign's selected tags or group, separated by semicolons), `{{website}}` (the sender's website), `{{cta}}`, `{{cta_url}}`, `{{language}}`, `{{pain_points}}`, `{{value_props}}`, `{{proof_points}}`, `{{subject}}`, and `{{message}}`. The live queue requests `{{username}}` and `{{password}}` at run time. A simulation uses the browser's existing sign-in session.

The extension requests optional permission for the selected site only when a user starts a task. Tasks and the last completed top-level action are stored locally in the browser. On restart, review the page before resuming. If a CAPTCHA, MFA prompt, security challenge, unexpected page, or uncertain click result appears, the run pauses for manual review. The extension does not solve or bypass challenges.

## Current scope

The AI's output is a bounded JSON action plan with a JavaScript preview, not arbitrary JavaScript execution. This keeps page interaction limited to the supported operations and makes action-level checkpointing possible. The AI uses the campaign's connected OpenAI integration. The current implementation targets the Chrome extension; Edge can be added after the Chrome workflow is established.
