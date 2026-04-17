import { useEffect, useState } from 'react'
import { adminApi, type Build, type BuildTestRun } from '../lib/adminApi'

const th = (label: string) => <th style={{ textAlign: 'left', padding: '8px 12px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A2A' }}>{label}</th>

const statusColor = (s: Build['status']) => s === 'verified' ? '#22C55E' : s === 'testing' ? '#F59E0B' : s === 'rejected' ? '#DC2626' : '#888'

function TestRunBadge({ label, run }: { label: string; run?: BuildTestRun }) {
  if (!run) {
    return (
      <div style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', borderRadius: 4, padding: '6px 10px', minWidth: 110 }}>
        <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', marginTop: 2 }}>— no runs —</div>
      </div>
    )
  }
  const ok = run.failed === 0
  return (
    <div style={{ background: '#0D0D0D', border: `1px solid ${ok ? '#22C55E40' : '#DC262640'}`, borderRadius: 4, padding: '6px 10px', minWidth: 110 }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>
        <span style={{ color: '#22C55E' }}>{run.passed}✓</span>
        {run.failed > 0 && <span style={{ color: '#DC2626', marginLeft: 6 }}>{run.failed}✗</span>}
        {run.skipped > 0 && <span style={{ color: '#F59E0B', marginLeft: 6 }}>{run.skipped}↷</span>}
        <span style={{ color: '#888', marginLeft: 6 }}>/ {run.total}</span>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 2, fontFamily: 'monospace' }} title={run.commit_hash ?? ''}>
        {run.commit_hash ? run.commit_hash.slice(0, 7) : '—'} · {new Date(run.created_at).toLocaleDateString('en-NZ')}
      </div>
    </div>
  )
}

export default function BuildsPage() {
  const [builds, setBuilds] = useState<Build[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ build_ref: '', title: '', notes: '' })
  const [addingBug, setAddingBug] = useState<string | null>(null)
  const [bugForm, setBugForm] = useState({ bug_ref: '', description: '' })

  const load = () => { setLoading(true); adminApi.listBuilds().then(data => { setBuilds(data ?? []); setLoading(false) }) }
  useEffect(() => { load() }, [])

  const createBuild = async () => {
    if (!form.build_ref || !form.title) return
    await adminApi.upsertBuild({ build_ref: form.build_ref, title: form.title, notes: form.notes })
    setForm({ build_ref: '', title: '', notes: '' }); setShowNew(false); load()
  }

  const addBug = async (buildId: string) => {
    if (!bugForm.bug_ref) return
    await adminApi.addBuildBug({ build_id: buildId, bug_ref: bugForm.bug_ref, description: bugForm.description })
    setBugForm({ bug_ref: '', description: '' }); setAddingBug(null); load()
  }

  const toggle = async (bugId: string, next: boolean) => { await adminApi.toggleBuildBug(bugId, next); load() }

  const setStatus = async (b: Build, status: Build['status']) => {
    await adminApi.upsertBuild({ id: b.id, build_ref: b.build_ref, title: b.title, notes: b.notes ?? undefined, status })
    load()
  }

  const deleteBuild = async (id: string, ref: string) => {
    if (!confirm(`Delete build ${ref} and all its bug entries?`)) return
    await adminApi.deleteBuild(id); load()
  }

  const input = { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#F5F5F5', fontSize: 13, outline: 'none' } as const
  const btn = { background: '#DC2626', border: 'none', color: '#F5F5F5', cursor: 'pointer', fontSize: 12, padding: '6px 14px', borderRadius: 4, fontWeight: 600 } as const
  const btnGhost = { background: 'none', border: '1px solid #2A2A2A', color: '#F5F5F5', cursor: 'pointer', fontSize: 11, padding: '3px 10px', borderRadius: 4 } as const

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Build List</h1>
        <button onClick={() => setShowNew(v => !v)} style={btn}>{showNew ? 'Cancel' : '+ New Build'}</button>
      </div>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>Confirm bugs fixed per build before release. {builds.length} builds tracked.</p>

      {showNew && (
        <div style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20, marginBottom: 24, display: 'grid', gap: 12, gridTemplateColumns: '160px 1fr 1fr auto' }}>
          <input placeholder='Ref (e.g. BUILD-15)' value={form.build_ref} onChange={e => setForm({ ...form, build_ref: e.target.value })} style={input} />
          <input placeholder='Title' value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={input} />
          <input placeholder='Notes (optional)' value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={input} />
          <button onClick={createBuild} style={btn}>Create</button>
        </div>
      )}

      {loading ? <div style={{ color: '#888' }}>Loading...</div> : builds.length === 0 ? <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>No builds yet. Create one to start tracking bug fixes.</div> : (
        <div style={{ display: 'grid', gap: 16 }}>
          {builds.map(b => {
            const total = b.admin_build_bugs?.length ?? 0
            const confirmed = b.admin_build_bugs?.filter(x => x.fixed_confirmed).length ?? 0
            const pct = total === 0 ? 0 : Math.round((confirmed / total) * 100)
            return (
              <div key={b.id} style={{ background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#DC2626', fontWeight: 700 }}>{b.build_ref}</span>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{b.title}</span>
                      <span style={{ fontSize: 10, color: statusColor(b.status), border: `1px solid ${statusColor(b.status)}40`, background: `${statusColor(b.status)}20`, padding: '2px 8px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{b.status}</span>
                    </div>
                    {b.notes && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{b.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={b.status} onChange={e => setStatus(b, e.target.value as Build['status'])} style={{ ...input, fontSize: 11, padding: '3px 8px' }}>
                      <option value='open'>open</option>
                      <option value='testing'>testing</option>
                      <option value='verified'>verified</option>
                      <option value='rejected'>rejected</option>
                    </select>
                    <button onClick={() => deleteBuild(b.id, b.build_ref)} style={{ ...btnGhost, borderColor: '#DC262650', color: '#DC2626' }}>Delete</button>
                  </div>
                </div>

                <div style={{ marginBottom: 10, height: 6, background: '#0D0D0D', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#22C55E' : '#DC2626', transition: 'width 200ms' }} />
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>{confirmed}/{total} bugs confirmed fixed ({pct}%)</div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <TestRunBadge label='Unit tests' run={b.latest_test_runs?.unit} />
                  <TestRunBadge label='Regression' run={b.latest_test_runs?.regression} />
                  <TestRunBadge label='E2E' run={b.latest_test_runs?.e2e} />
                </div>

                {total > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
                    <thead><tr>{th('Fixed')}{th('Bug')}{th('Description')}{th('Confirmed')}{th('')}</tr></thead>
                    <tbody>{b.admin_build_bugs.map(bug => (
                      <tr key={bug.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                        <td style={{ padding: '8px 12px' }}><input type='checkbox' checked={bug.fixed_confirmed} onChange={e => toggle(bug.id, e.target.checked)} style={{ accentColor: '#22C55E', width: 16, height: 16, cursor: 'pointer' }} /></td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#DC2626' }}>{bug.bug_ref}</td>
                        <td style={{ padding: '8px 12px', color: '#F5F5F5' }}>{bug.description || '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#888', fontSize: 11 }}>{bug.confirmed_at ? new Date(bug.confirmed_at).toLocaleString('en-NZ') : '—'}</td>
                        <td style={{ padding: '8px 12px' }}><button onClick={() => adminApi.deleteBuildBug(bug.id).then(load)} style={{ ...btnGhost, color: '#888', fontSize: 10 }}>×</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}

                {addingBug === b.id ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto auto', gap: 8 }}>
                    <input placeholder='BUG-xxx' value={bugForm.bug_ref} onChange={e => setBugForm({ ...bugForm, bug_ref: e.target.value })} style={{ ...input, padding: '6px 10px', fontSize: 12 }} />
                    <input placeholder='Description' value={bugForm.description} onChange={e => setBugForm({ ...bugForm, description: e.target.value })} style={{ ...input, padding: '6px 10px', fontSize: 12 }} />
                    <button onClick={() => addBug(b.id)} style={{ ...btn, padding: '4px 12px', fontSize: 11 }}>Add</button>
                    <button onClick={() => setAddingBug(null)} style={btnGhost}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingBug(b.id)} style={btnGhost}>+ Add bug to track</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
