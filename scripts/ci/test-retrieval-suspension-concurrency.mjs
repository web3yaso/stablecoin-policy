import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// Intentionally local-only; never reads .env or accepts a remote database URL.
const container = "supabase_db_stablecoin-policy";
function session(sql, interactive = false) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-A", "-t", "-q",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", b => { out += b; });
  child.stderr.on("data", b => { err += b; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => resolve({ code, out, err }));
  });
  if (interactive) child.stdin.write(sql); else child.stdin.end(sql);
  return { child, done, output: () => out };
}
async function sql(text) {
  const result = await session(text).done;
  assert.equal(result.code, 0, result.err);
  return result.out.trim();
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let n = 0; n < 100; n++) { if (await check()) return; await sleep(30); }
  throw new Error(`timed out waiting for ${label}`);
}
const hash = id => `(policy.get_retrieval_index_manifest('${id}')->>'manifestSha256')`;
const activate = id => `select policy.activate_retrieval_index_release('${id}',${hash(id)},clock_timestamp());`;
const rollback = scope => `select policy.rollback_retrieval_index_release('${scope}','PROVISIONAL',clock_timestamp());`;
const suspend = (scope, id, revision) => `select policy.suspend_retrieval_index_release(
  'suspend:${scope}','${scope}','PROVISIONAL','${id}',${hash(id)},${revision},'sanitized concurrency drill');`;

async function seedScope(scope) {
  const ids = [`index:rag-race:${scope}:a`, `index:rag-race:${scope}:b`];
  for (const id of ids) {
    await sql(`begin;
      insert into retrieval.index_releases(index_release_id,policy_domain,corpus_release_id,
        corpus_release_kind,assurance_tier,as_of,knowledge_cutoff,fresh_through,
        lexical_config,vector_config,embedding_model,embedding_model_version,embedding_dimensions)
      select '${id}','${scope}',corpus_release_id,corpus_release_kind,assurance_tier,as_of,
        knowledge_cutoff,fresh_through,lexical_config,vector_config,embedding_model,
        embedding_model_version,embedding_dimensions from retrieval.index_releases where index_release_id='index:rag-test:builder';
      insert into retrieval.index_release_chunks select '${id}',chunk_id,embedding_id,ordinal
        from retrieval.index_release_chunks where index_release_id='index:rag-test:builder';
      set local role service_role;
      select policy.record_retrieval_index_eval('eval:${id}','${id}',${hash(id)},'MACHINE_ASSURED','PASSED',repeat('b',64),
        '{"recallAt10":1,"mrrAt10":1,"citationPrecision":1,"versionIsolation":1,"checklistTopicCoverage":1,"rightsLeaks":0,"assuranceLeaks":0,"promptInstructionLeaks":0,"unsafeBuildsAccepted":0}',clock_timestamp());
      commit;`);
  }
  return ids;
}
// Keep the first transaction open after its RPC, prove that the second session
// is actually waiting on the scope lock, then commit. No timing-only race claim.
async function race(firstSql, secondSql) {
  const first = session(`begin; set local role service_role; ${firstSql}\n\\echo FIRST_READY\n`, true);
  let second;
  try {
    await until(() => first.output().includes("FIRST_READY"), "first RPC holding scope lock");
    second = session(`set application_name='rag-suspension-contender'; set lock_timeout='8s';
      set statement_timeout='10s'; set role service_role; ${secondSql}`);
    await until(async () => (await sql("select count(*) from pg_stat_activity where application_name='rag-suspension-contender' and wait_event='advisory';")) === "1", "contender blocked on advisory lock");
    first.child.stdin.end("commit;\n");
    const results = await Promise.all([first.done, second.done]);
    assert.equal(results[0].code, 0, results[0].err);
    return results[1];
  } finally {
    if (!first.child.stdin.writableEnded) first.child.stdin.end("rollback;\n");
    await first.done;
    if (second) await second.done;
  }
}
async function pointer(scope) {
  return JSON.parse(await sql(`select policy.inspect_retrieval_index_pointer('${scope}','PROVISIONAL');`));
}
async function auditCount(scope) {
  return Number(await sql(`select count(*) from retrieval.index_suspension_operations where policy_domain='${scope}';`));
}

const cleanup = `begin; set local session_replication_role=replica;
delete from retrieval.index_suspension_operations where policy_domain like 'rag-race-%';
delete from retrieval.active_index_pointers where policy_domain like 'rag-race-%'
  or active_index_release_id like 'index:rag-test:%';
delete from retrieval.index_eval_records where index_release_id like 'index:rag-race:%' or index_release_id like 'index:rag-test:%';
delete from retrieval.index_build_records where index_release_id like 'index:rag-test:%';
delete from retrieval.index_release_chunks where index_release_id like 'index:rag-race:%' or index_release_id like 'index:rag-test:%';
delete from retrieval.rag_retrieval_runs where index_release_id like 'index:rag-test:%';
delete from retrieval.index_releases where index_release_id like 'index:rag-race:%' or index_release_id like 'index:rag-test:%';
delete from retrieval.embedding_records where chunk_id='chunk:rag-test:1';
delete from retrieval.evidence_chunks where chunk_id='chunk:rag-test:1';
delete from retrieval.corpus_snapshot_claims where snapshot_id='snapshot:rag-test:aggregate';
delete from retrieval.corpus_snapshot_releases where snapshot_id='snapshot:rag-test:aggregate';
delete from retrieval.corpus_snapshots where snapshot_id='snapshot:rag-test:aggregate';
delete from policy.provisional_release_claims where release_id in ('provisional:rag-test:eea:1','provisional:rag-test:eea:2');
delete from policy.provisional_corpus_releases where release_id in ('provisional:rag-test:eea:1','provisional:rag-test:eea:2');
delete from policy.machine_assurance_records where record_id='record:rag-test:crosscheck';
delete from policy.citations where citation_id='citation:rag-test:1';
delete from policy.legal_claims where claim_id='claim:rag-test:1';
delete from regulatory.provisions where provision_id='provision:rag-test:1';
delete from regulatory.source_versions where version_id='version:rag-test:1';
delete from regulatory.source_documents where document_id='document:rag-test';
delete from regulatory.source_authorities where authority_id='authority:rag-test';
delete from policy.storage_objects where object_id='object:rag-test:1'; commit;`;

// Refuse to overwrite any existing fixture or stablecoin active-pointer data.
assert.equal(await sql(`select count(*) from retrieval.index_releases where index_release_id like 'index:rag-test:%'
  or index_release_id like 'index:rag-race:%' or policy_domain like 'rag-race-%';`), "0", "test fixtures already exist");
assert.equal(await sql("select count(*) from retrieval.active_index_pointers where policy_domain='stablecoin' or policy_domain like 'rag-race-%';"), "0", "test requires empty scope pointers");
assert.equal(await sql("select count(*) from policy.storage_objects where object_id='object:rag-test:1';"), "0", "source fixture already exists");
assert.equal(await sql(`select
  (select count(*) from regulatory.source_authorities where authority_id='authority:rag-test') +
  (select count(*) from regulatory.source_documents where document_id='document:rag-test') +
  (select count(*) from regulatory.source_versions where version_id='version:rag-test:1') +
  (select count(*) from regulatory.provisions where provision_id='provision:rag-test:1') +
  (select count(*) from policy.legal_claims where claim_id='claim:rag-test:1') +
  (select count(*) from policy.citations where citation_id='citation:rag-test:1') +
  (select count(*) from policy.machine_assurance_records where record_id='record:rag-test:crosscheck') +
  (select count(*) from policy.provisional_corpus_releases where release_id in ('provisional:rag-test:eea:1','provisional:rag-test:eea:2')) +
  (select count(*) from retrieval.corpus_snapshots where snapshot_id='snapshot:rag-test:aggregate') +
  (select count(*) from retrieval.index_suspension_operations where policy_domain like 'rag-race-%');`),
"0", "reserved fixture data already exists; refusing cleanup ownership");
try {
  const fixture = await readFile("supabase/tests/phase3_evidence_rag_foundation_test.sql", "utf8");
  const marker = "-- Suspension regression:";
  assert.equal(fixture.split(marker).length, 2);
  const setup = await sql(fixture.split(marker)[0] + "\nselect * from finish(); reset role; commit;\n");
  assert.doesNotMatch(setup, /not ok|Looks like you failed/);
  for (const suspendFirst of [true, false]) {
    const scope = `rag-race-activate-${suspendFirst ? "first" : "second"}`;
    const [a, b] = await seedScope(scope);
    await sql(activate(a));
    const result = await race(suspendFirst ? suspend(scope,a,1) : activate(b), suspendFirst ? activate(b) : suspend(scope,a,1));
    assert.equal(result.code, suspendFirst ? 0 : 3, result.err);
    if (!suspendFirst) assert.match(result.err, /pointer is stale/);
    const p = await pointer(scope);
    assert.equal(p.activeIndexReleaseId, b);
    assert.equal(p.revision, suspendFirst ? "3" : "2");
    assert.equal(await auditCount(scope), suspendFirst ? 1 : 0);
    console.log(`PASS suspend vs activate (${suspendFirst ? "suspend" : "activate"} commits first)`);
  }
  for (const suspendFirst of [true, false]) {
    const scope = `rag-race-rollback-${suspendFirst ? "first" : "second"}`;
    const [a, b] = await seedScope(scope);
    await sql(activate(a)); await sql(activate(b));
    const result = await race(suspendFirst ? suspend(scope,b,2) : rollback(scope), suspendFirst ? rollback(scope) : suspend(scope,b,2));
    assert.equal(result.code, 3);
    assert.match(result.err, suspendFirst ? /no eligible previous/ : /pointer is stale/);
    const p = await pointer(scope);
    assert.equal(p.activeIndexReleaseId, suspendFirst ? null : a);
    assert.equal(p.revision, "3");
    assert.equal(await auditCount(scope), suspendFirst ? 1 : 0);
    console.log(`PASS suspend vs rollback (${suspendFirst ? "suspend" : "rollback"} commits first)`);
  }
  {
    const scope = "rag-race-duplicate";
    const [a] = await seedScope(scope); await sql(activate(a));
    const result = await race(suspend(scope,a,1), suspend(scope,a,1));
    assert.equal(result.code, 0, result.err);
    const stored = JSON.parse(await sql(`select result from retrieval.index_suspension_operations where policy_domain='${scope}';`));
    assert.deepEqual(JSON.parse(result.out.trim()), stored);
    assert.equal(await auditCount(scope), 1);
    assert.equal((await pointer(scope)).revision, "2");
    console.log("PASS duplicate suspension: identical durable result, one transition");
  }
  {
    const scope = "rag-race-first-activation";
    const [a,b] = await seedScope(scope);
    const result = await race(activate(a), activate(b));
    assert.equal(result.code, 0, result.err);
    const p = await pointer(scope);
    assert.equal(p.activeIndexReleaseId,b); assert.equal(p.previousIndexReleaseId,a); assert.equal(p.revision,"2");
    assert.equal(await sql(`select count(*) from retrieval.index_releases where policy_domain='${scope}' and release_state='ACTIVE';`),"1");
    console.log("PASS competing first activations: one ACTIVE and consistent pointer");
  }
} finally {
  await sql(cleanup);
}
