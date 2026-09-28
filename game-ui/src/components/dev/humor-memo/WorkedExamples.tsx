import { Section, Example, DialogueExample } from "./shared";
import { slug } from "./slug";

const CATALOG: { archetype: string; technique: number; example: string }[] = [
  { archetype: "Problem as ritual preamble", technique: 6, example: "Restated at the top of every meeting about it, then set aside for the real agenda. Rare — needs a recurring-meeting premise most challenges won't have." },
  { archetype: "Literal scale collision", technique: 6, example: "The consent question is item 4 on the agenda, between office plant rotation and kitchen fridge cleaning schedule." },
  { archetype: "Retroactively-satisfiable criterion", technique: 5, example: "“The agreed goals” get decided after the results are in." },
  { archetype: "Silence mistaken for testimony", technique: 5, example: "The feature store hears a shrug and writes down zero, like someone gave it that number on purpose." },
  { archetype: "Undetectable falsehood in a plausible dataset", technique: 5, example: "Forty columns of numbers. Thirty-nine check out. Nobody knows which one doesn't." },
  { archetype: "Banal contingency collision", technique: 6, example: "The only heatwave plan on record recommends more scarves." },
  { archetype: "Procedural self-sabotage", technique: 6, example: "The shadow run is queued behind the deploy it's supposed to clear." },
  { archetype: "Representation mistaken for reality", technique: 6, example: "The display's plastic vegetables were the only produce left in the store." },
  { archetype: "Neutral magnitude analogy", technique: 6, example: "The bill doubled, exactly the threshold every dashboard already flags as trouble." },
  { archetype: "Recursive bureaucracy", technique: 5, example: "No, the sign-off form does not count as documentation of itself." },
  { archetype: "Personification", technique: 5, example: "The trucks do not know what an audit trail is, and I'm not the one explaining it to them before they leave." },
  { archetype: "Consequential finding filed with a trivial one", technique: 6, example: "The consent gap was filed beside a note about the breakroom fridge." },
  { archetype: "A label unrevised by the reality it names", technique: 6, example: "The flooded warehouse's stock is still labeled on the schedule as “as forecasted.”" },
  { archetype: "A health check that asks the wrong question", technique: 5, example: "The dashboard's green light only asks whether the service is breathing, not whether the numbers make sense." },
  { archetype: "A gap left idling with a pet's patience", technique: 5, example: "The deploy job sits by the door like a dog waiting to be let out." },
];

export default function WorkedExamples() {
  return (
    <Section
      id="worked"
      n="05"
      title="Twenty worked examples"
      lead="All 11 challenges now have a brief-level pass. 9 of 106 artifacts are done; picking the next batch is now a deterministic pipeline step (section 07), not a manual pick."
    >
      <div className="card mb-4">
        <div className="card-body">
          <h3 className="h6 fw-bold mb-2">Archetype catalog &mdash; 15 confirmed</h3>
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead><tr><th>Archetype</th><th>Technique</th><th>Example</th></tr></thead>
              <tbody>
                {CATALOG.map((row) => (
                  <tr key={row.archetype} id={`archetype-${slug(row.archetype)}`}>
                    <td>{row.archetype}</td>
                    <td><a href={`#technique-${row.technique}`}>#{row.technique}</a></td>
                    <td className="fst-italic">{row.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Example
        kind="brief"
        archetype="banal contingency collision"
        title="The Committed Pallets"
        source="GameProgression.json:174"
        original="A supplier has confirmed a bulk order for a middle aisle promotion that ships next week, leaving no room for model error. requirements_reuben insists the acceptance criteria must be fully governed to guarantee the allocation logic is auditable before the trucks leave. reliability_ruth argues the criteria are sufficient as manual checks because the physical stock is already committed and the team needs to ship the feature immediately to handle the live orders."
        rewriteLabel="Frame rewritten (96 words, 1.10x)"
        rewrite={'A supplier has confirmed a bulk order for a middle aisle promotion that ships next week, and the only contingency plan on file is a sticky note that says "don\'t." requirements_reuben insists the acceptance criteria must be fully governed to guarantee the allocation logic is auditable before the trucks leave. reliability_ruth argues the criteria are sufficient as manual checks because the physical stock is already committed and the team needs to ship the feature immediately to handle the live orders.'}
      />

      <Example
        kind="brief"
        archetype="problem as ritual preamble"
        title="The Midnight Deadline"
        source="GameProgression.json:845"
        original="The nightly data job is failing to finish before the store managers open the ordering app. reliability_ruth demands an automated validation layer to catch bad data instantly so the morning window is never missed again. data_dave insists on keeping the process manual for now, arguing that the infrastructure costs are too high and the current manual checks are sufficient to manage the risk."
        rewriteLabel="Frame rewritten (72 words, 1.14x)"
        rewrite="The nightly data job keeps failing to finish before store managers open the app, mentioned at each meeting, then set aside for the real agenda. reliability_ruth demands an automated validation layer to catch bad data instantly so the morning window is never missed again. data_dave insists on keeping the process manual for now, arguing that the infrastructure costs are too high and the current manual checks are sufficient to manage the risk."
      />

      <Example
        kind="brief"
        archetype="literal scale collision"
        title="The Consent Gap"
        source="GameProgression.json:688"
        original="A new model version requires loyalty basket data, but the deployment pipeline lacks the governance controls to verify consent. automation_alex wants to push the automated deployment forward immediately to meet the promotion deadline, while requirements_reuben insists on a manual review process to ensure legal compliance. automation_alex is open to adding a manual approval step if it keeps the pipeline moving, but requirements_reuben will not accept any automated path without full audit trails."
        rewriteLabel="Frame rewritten (82 words, 1.14x)"
        rewrite="A new model version requires loyalty basket data, but the deployment pipeline lacks the governance controls to verify consent, currently item four on the agenda, behind office plant rotation. automation_alex wants to push the automated deployment forward immediately to meet the promotion deadline, while requirements_reuben insists on a manual review process to ensure legal compliance. automation_alex is open to adding a manual approval step if it keeps the pipeline moving, but requirements_reuben will not accept any automated path without full audit trails."
      />

      <Example
        kind="brief"
        archetype="personification"
        title="The Summer Forecast Gap"
        source="GameProgression.json:533"
        original="A sudden heatwave has skewed demand for seasonal goods, exposing that our KPI definitions do not account for weather driven spikes. model_monica wants to automate the KPI tracking to capture these shifts in real time, while efficiency_emilia prefers to keep the process manual to ensure every metric aligns with the broader business strategy. efficiency_emilia might accept an automated solution if it clearly supports the agreed business goals."
        rewriteLabel="Frame rewritten (72 words, 1.07x)"
        rewrite="A sudden heatwave completely rewrote seasonal demand overnight, and the KPI definitions, which do not currently believe in weather, were the last to find out. model_monica wants to automate the KPI tracking to capture these shifts in real time, while efficiency_emilia prefers to keep the process manual to ensure every metric aligns with the broader business strategy. efficiency_emilia might accept an automated solution if it clearly supports the agreed business goals."
      />

      <Example
        kind="brief"
        archetype="consequential finding filed with a trivial one"
        title="The Loyalty Data Audit"
        source="GameProgression.json:580"
        original="A legal audit flagged that loyalty basket data lacks valid consent records, breaking the legal basis for using it in forecasts. requirements_reuben demands the data contracts be fully automated and governed to enforce consent checks before any data enters the pipeline. efficiency_emilia argues that manual review is sufficient for now to avoid delaying the promotion planning cycle, though she might accept a middle ground if it does not stall the weekly leaflet."
        rewriteLabel="Frame rewritten (80 words, 1.11x)"
        rewrite="A legal audit flagged that loyalty basket data lacks valid consent records, breaking the legal basis for using it in forecasts, filed beside a note about the breakroom fridge. requirements_reuben demands the data contracts be fully automated and governed to enforce consent checks before any data enters the pipeline. efficiency_emilia argues that manual review is sufficient for now to avoid delaying the promotion planning cycle, though she might accept a middle ground if it does not stall the weekly leaflet."
      />

      <Example
        kind="brief"
        archetype="a label unrevised by the reality it names"
        title="The Warehouse Flood"
        source="GameProgression.json:1256"
        original="A forecast job failed silently for three days, leaving stores ordering blind, and the team never knew until the warehouse was flooded with unsold promotion stock. reliability_ruth argues that the performance monitoring must be automated and governed to catch such failures instantly, while efficiency_emilia is willing to accept a manual monthly audit of the logs to save on tooling costs."
        rewriteLabel="Frame rewritten (69 words, 1.15x)"
        rewrite={'A forecast job failed silently for three days, leaving stores ordering blind, and the team never knew until the warehouse was flooded with unsold promotion stock, still labeled on the delivery schedule as "as forecasted." reliability_ruth argues that the performance monitoring must be automated and governed to catch such failures instantly, while efficiency_emilia is willing to accept a manual monthly audit of the logs to save on tooling costs.'}
      />

      <Example
        kind="brief"
        archetype="a health check that asks the wrong question"
        title="The Override Blind Spot"
        source="GameProgression.json:972"
        original="Store managers are overriding order suggestions at an alarming rate because they cannot verify if the model behind them is the one they tested. model_monica wants a fully automated registry to ensure every deployment is traceable and reproducible. requirements_reuben has a red line: no model enters the registry without a manual, documented review of its evaluation metrics to ensure compliance, so he insists on keeping the process manual."
        rewriteLabel="Frame rewritten (78 words, 1.15x)"
        rewrite="Store managers are overriding order suggestions at an alarming rate because they cannot verify if the model behind them is the one they tested, and their only check would pass a coin flip too. model_monica wants a fully automated registry to ensure every deployment is traceable and reproducible. requirements_reuben has a red line: no model enters the registry without a manual, documented review of its evaluation metrics to ensure compliance, so he insists on keeping the process manual."
      />

      <Example
        kind="brief"
        archetype="neutral magnitude analogy"
        title="The Cost Cliff"
        source="GameProgression.json:263"
        original="The infrastructure bill for the monitoring stack has doubled, and efficiency_emilia has drawn a hard line: she will not fund automated drift monitoring, insisting it is a luxury the business cannot afford. reliability_ruth argues that without automated and governed drift checks, the team is flying blind during promotion weeks, and she refuses to accept a manual process as a substitute for reliable signal."
        rewriteLabel="Frame rewritten (72 words, 1.14x)"
        rewrite="The infrastructure bill for the monitoring stack has doubled, exactly the threshold every dashboard already flags as trouble, and efficiency_emilia has drawn a hard line: she will not fund automated drift monitoring, insisting it is a luxury the business cannot afford. reliability_ruth argues that without automated and governed drift checks, the team is flying blind during promotion weeks, and she refuses to accept a manual process as a substitute for reliable signal."
      />

      <Example
        kind="artifact"
        archetype="undetectable falsehood in a plausible dataset"
        title="Reuben's governance memo"
        source="OfflineIntelArtifacts.json:267, Committed Pallets"
        original="The supplier has confirmed the bulk order for the middle aisle promotion, and the trucks leave next week. Because the physical stock is already committed, there is no room for model error in the allocation logic. I am not willing to approve this release if the acceptance criteria remain manual. We must have the criteria fully governed to guarantee the logic is auditable before the goods ship. Manual checks are not sufficient for this scale of financial and operational risk. I will not sign off on the deployment until the governance framework is in place and the audit trail is verifiable. This is a hard requirement for my team. We cannot accept the liability of an unauditable automated decision when the inventory is already locked in with the supplier."
        rewriteLabel="Rewrite (149 words)"
        rewrite={`Quick note: the trucks roll next week, the order's confirmed, the stock is committed, and there is no room in this plan for the model to be wrong. I won't approve the release with manual acceptance criteria. An unauditable automated decision might be flawless, or it might be wrong in exactly one place, and once the trucks leave there is no way to find out which. The logic needs to be governed and auditable before goods ship. Manual checks aren't sufficient for risk at this scale. I will not sign off until the governance framework is in place and the audit trail is verifiable end to end. This is a hard requirement for my team. Once the trucks leave, the inventory is locked in with the supplier, and I am not the one explaining afterward why an unauditable decision made the call. That liability is not mine to carry.`}
      />

      <Example
        kind="artifact"
        archetype="personification"
        title="Ruth's trade-off notes"
        source="OfflineIntelArtifacts.json:281, Committed Pallets"
        original="I am willing to accept that the acceptance criteria remain manual checks for this specific release. We can skip the full governance audit trail for the allocation logic right now. In exchange for that reduced oversight, I need to ship the feature immediately so we can handle the live orders before the trucks leave. The physical stock is already committed to the supplier, and the window is closing. If we wait for the governed pipeline to be fully in place, we risk missing the delivery date and leaving the stores without the promised middle aisle stock. I am trading the long term auditability of this specific run for the immediate operational certainty of getting the pallets to the distribution centres on time."
        rewrite="The trucks do not know what an audit trail is, and I am not going to be the one to explain it to them before they leave. So: acceptance criteria manual for this release, full governance audit trail for the allocation logic skipped for now, feature shipped immediately so we can get the live orders handled before the trucks go. The stock is already committed to the supplier and the window is closing, which is a sentence that is true whether or not our pipeline is governed. Wait for the governed version and we miss the delivery date, and the stores are left without the middle aisle stock we told them was coming. What I am offering is simple: I will give up the long-term auditability of this one run, and take, in return, the pallets actually arriving at the distribution centres on time. The trucks get their certainty. The paperwork can wait its turn."
      />

      <Example
        kind="brief"
        archetype="banal contingency collision"
        title="The Heatwave Blind Spot"
        source="GameProgression.json:416"
        original="A sudden heatwave has shifted demand for seasonal articles, and the current forecast is missing the mark. model_monica wants to automate the evaluation harness to test new weather features rapidly, while requirements_reuben wants to keep it manual to ensure every test case is rigorously documented before any model change is considered."
        rewriteLabel="Frame rewritten (53 words, 1.04x)"
        rewrite="A sudden heatwave has shifted demand for seasonal articles, and the only heatwave plan on record recommends more scarves. model_monica wants to automate the evaluation harness to test new weather features rapidly, while requirements_reuben wants to keep it manual to ensure every test case is rigorously documented before any model change is considered."
      />

      <Example
        kind="brief"
        archetype="procedural self-sabotage"
        title="The Locked Shadow"
        source="GameProgression.json:1108"
        original="A supplier contract for the next promotion week is already signed, and the team cannot deploy the new model without a shadow run to verify it. reliability_ruth demands a fully automated and governed shadow environment to protect the live forecast, while automation_alex insists on keeping it manual to avoid breaking the current pipeline stability."
        rewriteLabel="Frame rewritten (60 words, 1.11x)"
        rewrite="A supplier contract for the next promotion week is already signed, and the team cannot deploy the new model without a shadow run that's queued behind the deploy it's supposed to clear. reliability_ruth demands a fully automated and governed shadow environment to protect the live forecast, while automation_alex insists on keeping it manual to avoid breaking the current pipeline stability."
      />

      <Example
        kind="artifact"
        archetype="silence mistaken for testimony"
        title="Dave's ingestion document"
        source="OfflineIntelArtifacts.json:466, The Silent Store Gap"
        original="I need the ingestion pipeline to handle validation automatically for every store batch. Right now, if a northern store drops its till scan lines, the feature store just accepts the gap as zero demand. I want the system to flag missing or malformed records before they reach the model, without waiting for a human to check the logs. The more of this process that runs on its own, the fewer bad data points slip through to the forecast. I am looking for a setup where the pipeline itself catches the errors, so we stop relying on manual spot checks to keep the data clean."
        rewrite="If you ask a northern store how much people wanted this week and the scan lines never showed up, that's a shrug. The feature store hears the shrug and writes down zero, like that's a number somebody gave it on purpose. I don't want a person combing logs afterward to figure out which zeros were real. I want the pipeline itself to catch a missing or malformed record before the model ever gets to treat a shrug as an answer."
      />

      <Example
        kind="artifact"
        archetype="undetectable falsehood in a plausible dataset"
        title="Emilia's registry document"
        source="OfflineIntelArtifacts.json:856, The Override Blind Spot"
        original="I have reviewed the cost estimates for the proposed registry implementation. The fully automated solution requires a significant capital outlay for infrastructure and ongoing maintenance that I cannot justify against the current budget. I am prepared to accept a manual registry process if it reduces the total project cost by a substantial margin. The key is balancing the need for traceability with financial prudence. If the manual approach saves enough money, I will support that route. We need to ensure that the savings are real and not just theoretical. The decision should reflect the actual operational costs we face in running the distribution centres and managing supplier contracts."
        rewrite="I have reviewed the cost estimates for the proposed registry implementation. The fully automated solution needs capital and upkeep I can't justify against the current budget. I will accept a manual registry if it cuts total project cost by a substantial margin. The spreadsheet I was sent has forty columns of numbers. Thirty-nine of them check out. I don't know which one doesn't, and neither, I suspect, does whoever built it. What I actually need is one column: what running the distribution centres and managing the supplier contracts costs us today, in money, without adjectives. Weigh that against a manual process and its real burden, and if manual comes out cheaper by enough to matter, I'll sign. I care about traceability. I care more about not finding out in a year that the column I trusted was the one that was wrong."
      />

      <Example
        kind="brief"
        archetype="representation mistaken for reality"
        title="The Silent Store Gap"
        source="GameProgression.json:1397"
        original="A batch of till scan lines from the northern stores was silently dropped during last night's ingestion, causing the model to forecast zero demand for fresh produce. reliability_ruth argues that the ingestion pipeline must be fully automated to guarantee every store's data arrives on time, while data_dave is willing to accept a manual verification step to ensure data quality before it reaches the feature store."
        rewriteLabel="Frame rewritten (73 words, 1.12x)"
        rewrite="A batch of till scan lines from the northern stores vanished overnight. The model called that zero demand, ordered nothing, and by morning the display's plastic vegetables were the only produce left in the store. reliability_ruth argues that the ingestion pipeline must be fully automated to guarantee every store's data arrives on time, while data_dave is willing to accept a manual verification step to ensure data quality before it reaches the feature store."
      />

      <Example
        kind="artifact"
        archetype="a health check that asks the wrong question"
        title="Reuben's meeting notes"
        source="OfflineIntelArtifacts.json:424, The Silent Store Gap"
        original="We need to settle the validation architecture before we touch the ingestion code. I am not approving a pipeline where raw scan lines from the northern stores enter the feature store without governed validation checks. If the system cannot prove that every article record meets our data quality standards before it is stored, I will block the release. We cannot risk censored demand signals corrupting the forecast, and we have no room for manual overrides in the critical path. The validation logic must be automated, auditable, and strictly enforced. Until those controls are in place and verified, I will not sign off on the data flow. This is a hard requirement for compliance and system integrity, not a preference."
        rewriteLabel="Rewrite (145 words)"
        rewrite="We need the validation architecture settled before anyone touches the ingestion code. I am not approving a pipeline where raw scan lines from the northern stores enter the feature store on the strength of a check that only confirms a record showed up, not whether the number inside it is true. A censored demand signal that arrives on schedule looks exactly like a real one to a check like that, and by the time anyone notices, it has already corrupted the forecast. We have no room for manual overrides in the critical path either way. The validation logic must be automated, auditable, and it has to actually inspect the number, not just clock its arrival. Until those controls are in place and verified, I will not sign off on the data flow. This is a hard requirement for compliance and system integrity, not a preference."
      />

      <Example
        kind="artifact"
        archetype="recursive bureaucracy"
        title="Reuben's KPI baseline notes"
        source="OfflineIntelArtifacts.json:161, The Loyalty Data Audit"
        original="The audit confirmed that loyalty basket records lack valid consent, so that data is out of scope until the legal basis is restored. I am not evaluating any model against the next promotion cycle until the KPI definitions are formally documented and signed off. The current draft definitions are not agreed, and I will not proceed on assumptions. I expect the team to deliver a governed, automated consent check before any personal data re-enters the pipeline. I will not accept a manual review as a permanent fix, and I will not approve a model that relies on data without a verified legal basis. The KPI documentation is a prerequisite for my sign off, not a parallel task."
        rewriteLabel="Rewrite (127 words)"
        rewrite="The audit confirmed that loyalty basket records lack valid consent, so that data is out of scope until the legal basis is restored. I am not evaluating any model against the next promotion cycle until the KPI definitions are formally documented and signed off, and before anyone asks, no, the sign-off form does not count as documentation of itself. The current draft definitions are not agreed, and I will not proceed on assumptions. I expect a governed, automated consent check before any personal data re-enters the pipeline. I will not accept a manual review as a permanent fix, and I will not approve a model that relies on data without a verified legal basis. The KPI documentation is a prerequisite for my sign-off, not a parallel task."
      />

      <Example
        kind="artifact"
        archetype="a health check that asks the wrong question"
        title="Ruth's alerting audit"
        source="OfflineIntelArtifacts.json:1339, The Warehouse Flood"
        original="During last week's routine audit of the forecasting service, I checked the status of the monitoring hooks. The logs show that the nightly batch completes and writes its output files to the shared directory. However, the alerting service that is supposed to watch those files has no active connection to the monitoring queue. I watched the system for three consecutive nights. When the batch finished, the files appeared. No notification was sent to the on call channel. The dashboard still displays a green status indicator because the service reports a successful heartbeat, but the actual data validation step is skipped entirely. I simply observed the file timestamps and the empty alert history. There is no automated check confirming whether the numbers in those files are sane or stale."
        rewriteLabel="Rewrite (135 words)"
        rewrite="During last week's routine audit of the forecasting service, I checked the status of the monitoring hooks. The nightly batch completes and writes its output files to the shared directory, on schedule, every night. The alerting service that's supposed to watch those files has no active connection to the monitoring queue, and hasn't for three consecutive nights that I checked. No notification was sent to the on-call channel in any of them. The dashboard, meanwhile, shows a calm, confident green light, because the only thing it actually asks the service is whether it's still breathing, not whether anything it wrote makes sense. I compared file timestamps against the empty alert history. Nobody has checked whether the numbers in those files are sane or stale, and the green light has no opinion on that question either."
      />

      <Example
        kind="artifact"
        archetype="a gap left idling with a pet's patience"
        title="Alex's incident-review notes"
        source="OfflineIntelArtifacts.json:1051, The Consent Gap"
        original="I noticed the deployment flow during the last incident review. When the model registry confirms a new build, nothing automatically pushes it into the CI/CD pipeline. A person has to manually trigger that step every single time. I checked the logs for the past two weeks and saw the same pattern: the registry job finishes, then sits idle until someone clicks the deploy button in the dashboard. It is a simple gap in the automation chain. The infrastructure is ready, but the connection between the two systems relies entirely on human action to move the artifact forward. No alerts fire, no scripts run, just a waiting state until a teammate notices and acts."
        rewriteLabel="Rewrite (122 words)"
        rewrite="I noticed the deployment flow during the last incident review. When the model registry confirms a new build, nothing automatically pushes it into the CI/CD pipeline. A person has to manually trigger that step every single time. I checked the logs for the past two weeks and saw the same pattern: the registry job finishes, then sits by the door like a dog waiting to be let out, until someone in the office finally notices and clicks the deploy button. It is a simple gap in the automation chain. The infrastructure is ready, but the connection between the two systems relies entirely on someone remembering the job is there. No alerts fire, no scripts run, just a wait, however long that takes."
      />

      <Example
        kind="artifact"
        archetype="a ritual performed on schedule, disconnected from need"
        title="Monica's acceptance-criteria note"
        source="OfflineIntelArtifacts.json:103, The Summer Forecast Gap"
        original="I checked the repository and the pipeline logs for the current forecasting cycle. The acceptance criteria for model validation are not stored in the configuration files. Instead, I observed the team manually copying threshold values from a shared document into the test scripts before every weekly retraining run. This manual step happens every Friday evening. I noted that the values change occasionally based on recent performance discussions, but there is no automated check that verifies these numbers against a central source. The process relies entirely on the person running the job to input the correct figures each time."
        rewriteLabel="Rewrite (112 words)"
        rewrite="I checked the repository and the pipeline logs for the current forecasting cycle. The acceptance criteria for model validation are not stored in the configuration files. Instead, every Friday evening, someone opens a shared document and copies the threshold values into the test scripts by hand, the way a household changes the batteries in a smoke detector twice a year, whether or not it needs it. The values do change occasionally, based on recent performance discussions, but there is no automated check that verifies any of them against a central source. Whether the model gets validated against the right numbers depends entirely on whoever is running the job remembering to do it."
      />

      <h3 className="h6 fw-bold mt-4 mb-2">Pitch-dialogue candidates &mdash; not yet shippable</h3>
      <p className="text-secondary small">Real turns from a playtest account (<code>test-talk</code>), tested against the emotion states already persisted in production. Gated on the intensity scalar (section 10) not existing in code yet.</p>

      <DialogueExample
        speaker="requirements_reuben, anxious"
        emotion="anxious"
        archetype="a health check that asks the wrong question"
        original="This crosses my red line. The proposal completely bypasses governed validation, which we've agreed is mandatory before any data reaches the feature store. We cannot accept a pipeline that skips this critical control."
        rewrite="This crosses my red line. The proposal completely bypasses governed validation, which we've agreed is mandatory before any data reaches the feature store, not a green checkmark that just means the job didn't crash while somewhere downstream we're forecasting negative bread. We cannot accept a pipeline that skips this critical control."
      />

      <DialogueExample
        speaker="model_monica, anxious"
        emotion="anxious"
        archetype="silence mistaken for testimony"
        original="I explicitly asked for a fully automated model registry to ensure traceability and reproducibility. This proposal doesn't address that critical need at all. Without automation, we're still vulnerable to the same blind spots that caused the override spike."
        rewrite={`This proposal doesn't address that critical need at all, and if the override spike happens again, the honest answer to "which model did this" is still a shrug and a guess. Without automation, we're still vulnerable to the same blind spots that caused the override spike.`}
      />

      <DialogueExample
        speaker="data_dave, angry"
        emotion="angry"
        archetype="silence mistaken for testimony"
        original="This proposal completely ignores the core issue of data quality. We asked for automated validation to catch drops like this before they poison the model, not just more custom scripts that will still fail silently. If we don't fix that, we're just kicking the can down the road."
        rewrite="This proposal completely ignores the core issue of data quality. We asked for automated validation to catch drops like this before they poison the model, not just more custom scripts that shrug, write down zero, and call it settled. If we don't fix that, we're just kicking the can down the road."
      />

      <DialogueExample
        speaker="efficiency_emilia, relieved"
        emotion="relieved"
        archetype="undetectable falsehood in a plausible dataset"
        original="This proposal directly addresses the silent store gap by locking down the ingestion pipeline. Raising the validation to fully governed status will prevent these gaps from slipping through. I'm fully supportive of this path forward."
        rewrite="This proposal directly addresses the silent store gap by locking down the ingestion pipeline. Raising the validation to fully governed status will prevent these gaps from slipping through, the same gap that would currently wave through a scan line for a product we stopped selling two years ago. I'm fully supportive of this path forward."
      />
    </Section>
  );
}
