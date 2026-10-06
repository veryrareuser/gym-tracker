// Administrator maintenance. Credentials stay in memory and are never logged.
import { execFileSync } from 'node:child_process'
const credential = execFileSync('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
})
const password = credential.split('\n').find(line => line.startsWith('password='))?.slice(9)
if (!password) throw new Error('GitHub credential unavailable')
const root = 'https://api.github.com/repos/veryrareuser/gym-tracker'
async function api(method, path, body) {
  const response = await fetch(root + path, { method, headers: {
    Authorization: `Bearer ${password}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
  }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${value?.message || ''}`)
  return value
}
const mode = process.argv[2]
if (mode === 'configure') {
  await api('PUT', '/pages', { build_type: 'workflow' })
  await api('PUT', '/vulnerability-alerts')
  await api('PUT', '/automated-security-fixes')
  await api('PATCH', '', { security_and_analysis: {
    secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' },
  } })
  console.log('Pages workflow publishing, dependency alerts/fixes and secret push protection enabled.')
} else if (mode === 'protect') {
  await api('PUT', '/branches/main/protection', {
    required_status_checks: { strict: true, contexts: ['verify'] }, enforce_admins: true,
    required_pull_request_reviews: { required_approving_review_count: 0, dismiss_stale_reviews: true },
    restrictions: null, required_linear_history: true, allow_force_pushes: false,
    allow_deletions: false, required_conversation_resolution: true,
  })
  await api('PUT', '/branches/gh-pages/protection', {
    required_status_checks: null, enforce_admins: true, required_pull_request_reviews: null,
    restrictions: null, allow_force_pushes: false, allow_deletions: false,
  })
  console.log('Protected main: PR + passing verify required, including administrators. Both branches disallow force pushes/deletion.')
} else if (mode === 'status') {
  const runs = await api('GET', '/actions/runs?per_page=3')
  console.log(JSON.stringify(runs.workflow_runs.map(({id,name,status,conclusion,head_sha,html_url}) => ({id,name,status,conclusion,head_sha,html_url}))))
  const pages = await api('GET', '/pages')
  console.log(JSON.stringify({pages: pages.html_url, build_type: pages.build_type}))
  const repo = await api('GET', '')
  console.log(JSON.stringify({security: repo.security_and_analysis}))
  for (const branch of ['main','gh-pages']) {
    const value = await api('GET', `/branches/${branch}`)
    console.log(JSON.stringify({branch, protected: value.protected}))
  }
} else throw new Error('Use configure, protect or status')
