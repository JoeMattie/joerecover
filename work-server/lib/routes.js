import { renderLayout, formatNumber } from './ui.js';
import { expandTokenContent, calculatePermutations } from './expansion.js';

export function registerRoutes(app, db, sse) {
  // Dashboard
  app.get('/', (c) => {
    const stats = db.getOverallStats();
    const recentJobs = db.getAllJobs().slice(0, 5);
    const runningJobs = db.getAllJobs().filter(j => j.status === 'running').slice(0, 5);

    const content = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-white rounded-lg shadow-lg p-6"><div class="flex items-center justify-between"><div><p class="text-gray-500 text-sm">Total Jobs</p><p class="text-3xl font-bold text-blue-600" data-total-jobs>${stats?.total_jobs || 0}</p></div><i class="fas fa-tasks text-blue-400 text-2xl"></i></div></div>
        <div class="bg-white rounded-lg shadow-lg p-6"><div class="flex items-center justify-between"><div><p class="text-gray-500 text-sm">Active Jobs</p><p class="text-3xl font-bold text-green-600" data-active-jobs>${stats?.active_jobs || 0}</p></div><i class="fas fa-play text-green-400 text-2xl"></i></div></div>
        <div class="bg-white rounded-lg shadow-lg p-6"><div class="flex items-center justify-between"><div><p class="text-gray-500 text-sm">Online Workers</p><p class="text-3xl font-bold text-purple-600" data-online-workers>${stats?.online_workers || 0}</p></div><i class="fas fa-users text-purple-400 text-2xl"></i></div></div>
        <div class="bg-white rounded-lg shadow-lg p-6"><div class="flex items-center justify-between"><div><p class="text-gray-500 text-sm">Total Found</p><p class="text-3xl font-bold text-yellow-600" data-total-found>${formatNumber(stats?.total_found || 0)}</p></div><i class="fas fa-key text-yellow-400 text-2xl"></i></div></div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div class="bg-white rounded-lg shadow-lg">
          <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center"><h2 class="text-lg font-semibold">Running Jobs</h2><a href="/jobs" class="text-blue-600 hover:text-blue-800">View All</a></div>
          <div class="p-6" data-running-jobs>
            ${runningJobs.length === 0 ? '<p class="text-gray-500 text-center py-8">No jobs currently running. <a href="/jobs/new" class="text-blue-600 hover:underline">Create a new job</a></p>' : runningJobs.map(job => {
              const progress = job.total_permutations > 0 ? (job.total_processed / job.total_permutations * 100) : 0;
              return `<div class="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0"><div class="flex-1"><div class="flex items-center"><span class="text-lg mr-2">🏃</span><a href="/jobs/${job.id}" class="font-medium text-blue-600 hover:text-blue-800">${job.name}</a></div><div class="mt-1"><div class="w-full bg-gray-200 rounded-full h-2"><div class="bg-blue-600 h-2 rounded-full transition-all duration-500" style="width: ${Math.min(progress, 100)}%"></div></div><p class="text-xs text-gray-500 mt-1">${progress.toFixed(1)}% - ${formatNumber(job.total_processed)} / ${formatNumber(job.total_permutations)}</p></div></div><div class="text-right ml-4"><p class="text-sm font-medium text-green-600">${job.status}</p><p class="text-xs text-gray-500">Found: ${formatNumber(job.total_found)}</p></div></div>`; }).join('')}
          </div>
        </div>
        <div class="bg-white rounded-lg shadow-lg"><div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center"><h2 class="text-lg font-semibold">Active Workers</h2><a href="/workers" class="text-blue-600 hover:text-blue-800">View All</a></div><div class="p-6"><div id="workers-placeholder" class="text-gray-500 text-center py-8">Open Workers page for details</div></div></div>
      </div>`;

    return c.html(renderLayout('Dashboard', content));
  });

  // API for expand tokens
  app.post('/api/expand_tokens', async (c) => {
    const body = await c.req.json();
    const tokenContent = body.tokenContent;
    if (!tokenContent || !tokenContent.trim()) {
      return c.json({ success: false, error: 'Token content is required', totalPermutations: 0, expandedContent: '', projectedTime: '', originalLines: 0 });
    }
    const result = await expandTokenContent(tokenContent);
    
    // Transform the result to match the expected frontend format
    if (result.success) {
      const sampleExpansions = result.expandedContent 
        ? result.expandedContent.split('\n').filter(line => line.trim())
        : [];
      
      return c.json({
        success: true,
        total_permutations: result.totalPermutations,
        sample_expansions: sampleExpansions,
        projected_time: result.projectedTime,
        original_lines: result.originalLines
      });
    } else {
      return c.json({
        success: false,
        error: result.error,
        total_permutations: 0,
        sample_expansions: [],
        projected_time: '',
        original_lines: 0
      });
    }
  });

  // SSE endpoint for periodic refresh events
  app.get('/sse', (c) => sse.subscribe(c));

  // Jobs list
  app.get('/jobs', (c) => {
    const jobs = db.getAllJobs();
    const content = `
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Jobs</h1>
        <a href="/jobs/new" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center">
          <i class="fas fa-plus mr-2"></i>
          New Job
        </a>
      </div>

      <div class="bg-white rounded-lg shadow-lg overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Found</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200" id="jobs-table-body">
            ${jobs.length === 0 ? 
              '<tr><td colspan="6" class="px-6 py-8 text-center text-gray-500">No jobs found. <a href="/jobs/new" class="text-blue-600 hover:underline">Create your first job</a></td></tr>' :
              jobs.map(job => {
                const progress = job.total_permutations > 0 ? (job.total_processed / job.total_permutations * 100) : 0;
                const statusIcon = job.status === 'running' ? '🏃' : job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : job.status === 'paused' ? '⏸️' : '📄';
                return `
                  <tr class="hover:bg-gray-50">
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="flex items-center">
                        <span class="text-lg mr-2">${statusIcon}</span>
                        <div>
                          <div class="text-sm font-medium text-gray-900">${job.name}</div>
                          <div class="text-sm text-gray-500">Priority: ${job.priority}</div>
                        </div>
                      </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full 
                        ${job.status === 'completed' ? 'bg-green-100 text-green-800' :
                          job.status === 'running' ? 'bg-blue-100 text-blue-800' :
                          job.status === 'failed' ? 'bg-red-100 text-red-800' :
                          job.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'}">
                        ${job.status}
                      </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-900">${formatNumber(job.total_processed)} / ${formatNumber(job.total_permutations || 0)}</div>
                      <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                        <div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min(progress, 100)}%"></div>
                      </div>
                      <div class="text-xs text-gray-500 mt-1">${progress.toFixed(1)}%</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${formatNumber(job.total_found)}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${new Date(job.created_at).toLocaleDateString()}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div class="flex space-x-2">
                        <a href="/jobs/${job.id}" class="text-blue-600 hover:text-blue-900">View</a>
                        ${job.status === 'pending' || job.status === 'paused' ? `<button class="text-green-600 hover:text-green-900" onclick="resumeJob('${job.id}')">Resume</button>` : ''}
                        ${job.status === 'running' ? `<button class="text-yellow-600 hover:text-yellow-900" onclick="pauseJob('${job.id}')">Pause</button>` : ''}
                        ${job.status === 'pending' || job.status === 'paused' || job.status === 'failed' || job.status === 'completed' ? `<button class="text-red-600 hover:text-red-900" onclick="deleteJob('${job.id}')">Delete</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')
            }
          </tbody>
        </table>
      </div>

      <script>
        function resumeJob(jobId) {
          if (confirm('Resume this job?')) {
            fetch('/api/jobs/' + jobId + '/resume', { method: 'POST' })
              .then(r => r.ok ? refreshJobsTable() : alert('Failed to resume job'))
              .catch(() => alert('Failed to resume job'));
          }
        }
        function pauseJob(jobId) {
          if (confirm('Pause this job?')) {
            fetch('/api/jobs/' + jobId + '/pause', { method: 'POST' })
              .then(r => r.ok ? refreshJobsTable() : alert('Failed to pause job'))
              .catch(() => alert('Failed to pause job'));
          }
        }
        function deleteJob(jobId) {
          if (confirm('Are you sure you want to delete this job? This action cannot be undone.')) {
            fetch('/api/jobs/' + jobId, { method: 'DELETE' })
              .then(r => r.ok ? refreshJobsTable() : alert('Failed to delete job'))
              .catch(() => alert('Failed to delete job'));
          }
        }
        function refreshJobsTable() {
          fetch('/api/jobs_data')
            .then(r => r.text())
            .then(html => { document.getElementById('jobs-table-body').innerHTML = html; })
            .catch(() => {});
        }
        setInterval(refreshJobsTable, 10000);
      </script>
    `;
    return c.html(renderLayout('Jobs', content));
  });

  // New job form
  app.get('/jobs/new', (c) => {
    const content = `
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Create New Job</h1>
        <a href="/jobs" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg">Back to Jobs</a>
      </div>
      
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Left side: Form -->
        <div class="bg-white rounded-lg shadow-lg p-6">
          <h2 class="text-lg font-semibold mb-4">Job Configuration</h2>
          <form id="jobForm" class="space-y-4">
            <div>
              <label for="jobName" class="block text-sm font-medium text-gray-700 mb-2">Job Name</label>
              <input type="text" id="jobName" name="jobName" required 
                     class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                     placeholder="Enter a descriptive name for this job">
            </div>
            
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="chunkSize" class="block text-sm font-medium text-gray-700 mb-2">Chunk Size</label>
                <input type="number" id="chunkSize" name="chunkSize" value="1000000" min="1000" max="100000000" required
                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                       placeholder="1000000">
              </div>
              
              <div>
                <label for="priority" class="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                <select id="priority" name="priority" 
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                  <option value="0">Normal (0)</option>
                  <option value="1">High (1)</option>
                  <option value="2">Very High (2)</option>
                  <option value="-1">Low (-1)</option>
                  <option value="-2">Very Low (-2)</option>
                </select>
              </div>
            </div>
            
            <div>
              <label for="skipFirst" class="block text-sm font-medium text-gray-700 mb-2">Skip First N Permutations (Optional)</label>
              <input type="number" id="skipFirst" name="skipFirst" value="0" min="0"
                     class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                     placeholder="0">
              <p class="text-sm text-gray-500 mt-1">Skip the first N permutations and mark them as already completed. Useful for resuming from a specific point.</p>
            </div>
            
            <div>
              <label for="createdBy" class="block text-sm font-medium text-gray-700 mb-2">Created By (Optional)</label>
              <input type="text" id="createdBy" name="createdBy"
                     class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                     placeholder="Your name or identifier">
            </div>
            
            <div>
              <label for="notes" class="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
              <textarea id="notes" name="notes" rows="2"
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Any additional information about this job"></textarea>
            </div>
            
            <div>
              <label for="tokenContent" class="block text-sm font-medium text-gray-700 mb-2">Token Content</label>
              <textarea id="tokenContent" name="tokenContent" rows="10" required
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                        placeholder="Enter your seed phrase tokens, one per line. Use rule-based wildcards in [] brackets.&#10;Examples:&#10;abandon&#10;[len:4]&#10;about&#10;[first:b]&#10;[len:5-7]&#10;abroad"></textarea>
              <p class="text-sm text-gray-500 mt-1">Use rule-based wildcards like [len:4], [first:b], [last:y], [has:qt], [all], etc. Each line should contain one token or rule.</p>
            </div>
            
            <button type="submit" id="submitBtn"
                    class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition duration-200">
              Create Job
            </button>
          </form>
        </div>
        
        <!-- Right side: Live Preview -->
        <div class="bg-white rounded-lg shadow-lg p-6">
          <h2 class="text-lg font-semibold mb-4">Live Preview</h2>
          
          <!-- Permutation Statistics -->
          <div id="permutationInfo" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 hidden">
            <div class="grid grid-cols-2 gap-4 text-center">
              <div>
                <div class="text-2xl font-bold text-blue-600" id="permutationCount">-</div>
                <div class="text-sm text-blue-800">Total Permutations</div>
              </div>
              <div>
                <div class="text-2xl font-bold text-green-600" id="chunkCount">-</div>
                <div class="text-sm text-green-800">Estimated Chunks</div>
              </div>
            </div>
            <div id="skipInfo" class="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg hidden">
              <div class="text-center">
                <div class="text-lg font-bold text-yellow-600" id="skipCount">-</div>
                <div class="text-sm text-yellow-800">Permutations will be skipped</div>
                <div class="text-xs text-yellow-700 mt-1">These will be marked as completed initially</div>
              </div>
            </div>
          </div>
          
          <!-- Expansion Preview -->
          <div id="expansionPreview" class="hidden">
            <div class="flex justify-between items-center mb-2">
              <h3 class="text-md font-medium text-gray-700">Expanded Tokens</h3>
              <div class="text-xs text-gray-500" id="expansionCount">0 expansions</div>
            </div>
            <div class="bg-gray-50 border rounded-lg p-3 max-h-80 overflow-y-auto">
              <pre id="expansionSamples" class="text-sm font-mono text-gray-800 whitespace-pre-wrap"></pre>
            </div>  
          </div>
          
          <!-- Loading state -->
          <div id="loadingState" class="hidden text-center py-8">
            <div class="animate-spin inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mb-2"></div>
            <div class="text-sm text-gray-600">Calculating permutations...</div>
          </div>
          
          <!-- Empty state -->
          <div id="emptyState" class="text-center py-8 text-gray-500">
            <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <div class="text-sm">Enter token content to see live preview</div>
          </div>
        </div>
      </div>
      
      <script>
        const form = document.getElementById('jobForm');
        const tokenContent = document.getElementById('tokenContent');
        const chunkSize = document.getElementById('chunkSize');
        const skipFirst = document.getElementById('skipFirst');
        const permutationInfo = document.getElementById('permutationInfo');
        const permutationCount = document.getElementById('permutationCount');
        const chunkCount = document.getElementById('chunkCount');
        const skipInfo = document.getElementById('skipInfo');
        const skipCount = document.getElementById('skipCount');
        const expansionPreview = document.getElementById('expansionPreview');
        const expansionSamples = document.getElementById('expansionSamples');
        const expansionCount = document.getElementById('expansionCount');
        const loadingState = document.getElementById('loadingState');
        const emptyState = document.getElementById('emptyState');
        const submitBtn = document.getElementById('submitBtn');
        
        let lastTokenContent = '';
        let lastChunkSize = '';
        let lastSkipFirst = '';
        let isLoading = false;
        
        function showState(state) {
          permutationInfo.classList.add('hidden');
          expansionPreview.classList.add('hidden');
          loadingState.classList.add('hidden');
          emptyState.classList.add('hidden');
          
          if (state === 'loading') {
            loadingState.classList.remove('hidden');
          } else if (state === 'empty') {
            emptyState.classList.remove('hidden');
          } else if (state === 'preview') {
            permutationInfo.classList.remove('hidden');
            expansionPreview.classList.remove('hidden');
          }
        }
        
        function updateLivePreview() {
          const tokens = tokenContent.value.trim();
          const chunkSizeValue = parseInt(chunkSize.value) || 1000000;
          const skipFirstValue = parseInt(skipFirst.value) || 0;
          
          if (tokens === lastTokenContent && chunkSizeValue.toString() === lastChunkSize && skipFirstValue.toString() === lastSkipFirst) {
            return; // No change
          }
          
          lastTokenContent = tokens;
          lastChunkSize = chunkSizeValue.toString();
          lastSkipFirst = skipFirstValue.toString();
          
          if (!tokens) {
            showState('empty');
            return;
          }
          
          if (isLoading) return; // Prevent multiple concurrent requests
          
          isLoading = true;
          showState('loading');
          
          fetch('/api/expand_tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenContent: tokens })
          })
          .then(r => r.json())
          .then(data => {
            console.log('API Response:', data); // Debug log
            
            if (data.error || !data.success) {
              console.log('Error or no success:', data.error);
              showState('empty');
              return;
            }
            
            const perms = data.total_permutations;
            const chunks = Math.ceil(perms / chunkSizeValue);
            const skipFirstValue = parseInt(skipFirst.value) || 0;
            
            permutationCount.textContent = formatNumber(perms);
            chunkCount.textContent = formatNumber(chunks);
            
            // Show skip information if applicable
            if (skipFirstValue > 0 && skipFirstValue < perms) {
              skipCount.textContent = formatNumber(Math.min(skipFirstValue, perms));
              skipInfo.classList.remove('hidden');
            } else {
              skipInfo.classList.add('hidden');
            }
            
            // Show all expansions
            const samples = data.sample_expansions || [];
            console.log('Samples:', samples); // Debug log
            expansionSamples.textContent = samples.join('\\n');
            expansionCount.textContent = \`\${samples.length} expansion\${samples.length !== 1 ? 's' : ''}\`;
            
            showState('preview');
          })
          .catch((err) => {
            console.error('Fetch error:', err);
            showState('empty');
          })
          .finally(() => {
            isLoading = false;
          });
        }
        
        function formatNumber(num) {
          return new Intl.NumberFormat().format(num);
        }
        
        // Debounced update
        let debounceTimer;
        function debouncedUpdate() {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(updateLivePreview, 800);
        }
        
        tokenContent.addEventListener('input', debouncedUpdate);
        chunkSize.addEventListener('input', debouncedUpdate);
        skipFirst.addEventListener('input', debouncedUpdate);
        
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          
          const formData = new FormData(form);
          const data = {
            name: formData.get('jobName'),
            tokenContent: formData.get('tokenContent'),
            chunkSize: parseInt(formData.get('chunkSize')),
            priority: parseInt(formData.get('priority')),
            skipFirst: parseInt(formData.get('skipFirst')) || 0,
            createdBy: formData.get('createdBy') || null,
            notes: formData.get('notes') || ''
          };
          
          if (!data.name.trim()) {
            alert('Please enter a job name');
            return;
          }
          
          if (!data.tokenContent.trim()) {
            alert('Please enter token content');
            return;
          }
          
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
          
          fetch('/api/jobs', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(data)
          })
          .then(r => r.json())
          .then(data => {
            if (data.error) {
              alert('Error creating job: ' + data.error);
              return;
            }
            
            // Redirect to the new job's detail page
            window.location.href = '/jobs/' + data.id;
          })
          .catch(err => {
            alert('Failed to create job: ' + err.message);
          })
          .finally(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Job';
          });
        });
        
        // Initialize with empty state
        showState('empty');
      </script>
    `;
    return c.html(renderLayout('Create New Job', content));
  });

  // Workers list (HTML table auto-refresh served by API below)
  app.get('/workers', (c) => {
    const workers = db.getActiveWorkers();
    const content = `
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Workers</h1>
        <div class="text-sm text-gray-500">Auto-refreshing every 5 seconds</div>
      </div>
      <div class="bg-white rounded-lg shadow-lg overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Worker</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Work</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200" id="workers-table-body">
            ${workers.length === 0 ? '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">No workers connected</td></tr>' : workers.map(worker => {
              const isOnline = worker.actual_status !== 'offline';
              
              // Safe capability parsing
              let threads = 'Unknown';
              try {
                if (worker.capabilities && worker.capabilities !== '{}' && worker.capabilities !== '') {
                  const capabilities = JSON.parse(worker.capabilities);
                  threads = capabilities.threads || capabilities.thread_count || 'Unknown';
                }
              } catch (e) {
                threads = 'Unknown';
              }
              
              // Safe time calculation
              let timeDisplay = 'Unknown';
              try {
                const lastSeen = new Date(worker.last_heartbeat);
                if (!isNaN(lastSeen.getTime())) {
                  const timeAgo = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
                  if (timeAgo >= 0) {
                    if (timeAgo < 60) {
                      timeDisplay = `${timeAgo}s ago`;
                    } else if (timeAgo < 3600) {
                      timeDisplay = `${Math.floor(timeAgo/60)}m ago`;
                    } else if (timeAgo < 86400) {
                      timeDisplay = `${Math.floor(timeAgo/3600)}h ago`;
                    } else {
                      timeDisplay = `${Math.floor(timeAgo/86400)}d ago`;
                    }
                  }
                }
              } catch (e) {
                timeDisplay = 'Unknown';
              }
              
              return `
                <tr class="${isOnline ? 'bg-white' : 'bg-gray-50'}">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center">
                      <div class="w-3 h-3 rounded-full mr-3 ${isOnline ? 'bg-green-400' : 'bg-red-400'}"></div>
                      <div>
                        <div class="text-sm font-medium text-gray-900">${worker.id}</div>
                        <div class="text-sm text-gray-500">${threads} threads</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${worker.actual_status}</span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>Total: ${formatNumber(worker.total_processed)}</div>
                    <div class="text-xs text-gray-500">${(worker.average_rate || 0).toFixed(0)}/sec avg</div>
                    <div class="text-xs text-gray-500">Found: ${worker.total_found}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${worker.current_chunk_id ? `<span class="text-blue-600">Working on chunk</span><br><code class="text-xs">${worker.current_chunk_id.substring(0, 8)}...</code>` : '<span class="text-gray-400">Idle</span>'}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${timeDisplay}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <script>
        setInterval(() => {
          fetch('/api/workers_data').then(r => r.text()).then(html => { document.getElementById('workers-table-body').innerHTML = html; });
        }, 5000);
      </script>`;
    return c.html(renderLayout('Workers', content));
  });

  // Job detail view
  app.get('/jobs/:id', (c) => {
    const jobId = c.req.param('id');
    const job = db.getJobProgress(jobId);
    if (!job) {
      return c.html(renderLayout('Job Not Found', `<div class=\"text-center py-12\"><i class=\"fas fa-exclamation-triangle text-6xl text-gray-400 mb-4\"></i><h2 class=\"text-2xl font-bold text-gray-900 mb-2\">Job Not Found</h2><p class=\"text-gray-600 mb-6\">The requested job could not be found.</p><a href=\"/jobs\" class=\"bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg\">Back to Jobs</a></div>`));
    }
    const progress = job.total_permutations > 0 ? (job.total_processed / job.total_permutations * 100) : 0;
    const chunks = db.db.prepare(`SELECT status, COUNT(*) as count, SUM(processed_count) as total_processed, SUM(found_count) as total_found FROM work_chunks WHERE job_id = ? GROUP BY status`).all(jobId);
    const foundResults = db.db.prepare(`SELECT * FROM found_results WHERE job_id = ? ORDER BY found_at DESC LIMIT 50`).all(jobId);
    
    const chunkStatsHtml = chunks.map(chunk => `
      <div class="bg-gray-50 px-4 py-3 rounded-lg">
        <div class="text-sm font-medium capitalize">${chunk.status}</div>
        <div class="text-lg font-bold">${formatNumber(chunk.count)}</div>
        <div class="text-xs text-gray-500">chunks</div>
      </div>
    `).join('');
    
    const foundResultsHtml = foundResults.length > 0 ? foundResults.map(result => `
      <tr class="border-b border-gray-200">
        <td class="px-4 py-3 text-sm font-mono">${result.address}</td>
        <td class="px-4 py-3 text-sm font-mono max-w-xs truncate">${result.seed_phrase || 'N/A'}</td>
        <td class="px-4 py-3 text-sm text-gray-600">${new Date(result.found_at).toLocaleString()}</td>
      </tr>
    `).join('') : '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-500">No results found yet</td></tr>';
    
    const content = `
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">${job.name}</h1>
          <div class="text-sm text-gray-500">Job ID: ${job.id}</div>
        </div>
        <div class="flex space-x-2" data-actions>
          ${job.status === 'pending' || job.status === 'paused' ? `<button onclick="resumeJob('${job.id}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">Resume</button>` : ''}
          ${job.status === 'running' ? `<button onclick="pauseJob('${job.id}')" class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg">Pause</button>` : ''}
          ${job.status === 'pending' || job.status === 'paused' || job.status === 'failed' || job.status === 'completed' ? `<button onclick="deleteJob('${job.id}')" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg">Delete</button>` : ''}
          <a href="/jobs" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">Back to Jobs</a>
        </div>
      </div>
      
      <!-- Job Status and Progress -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-white p-6 rounded-lg shadow" data-status>
          <div class="flex items-center">
            <div class="text-2xl mr-2">${job.status === 'completed' ? '✅' : job.status === 'running' ? '🏃' : job.status === 'paused' ? '⏸️' : job.status === 'failed' ? '❌' : '📄'}</div>
            <div>
              <div class="text-lg font-semibold capitalize">${job.status}</div>
              <div class="text-sm text-gray-500">Status</div>
            </div>
          </div>
        </div>
        
        <div class="bg-white p-6 rounded-lg shadow" data-progress>
          <div class="text-2xl font-bold text-blue-600">${progress.toFixed(2)}%</div>
          <div class="text-sm text-gray-500">Progress</div>
          <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
            <div class="bg-blue-600 h-2 rounded-full" style="width: ${progress}%"></div>
          </div>
        </div>
        
        <div class="bg-white p-6 rounded-lg shadow" data-processed>
          <div class="text-2xl font-bold text-green-600">${formatNumber(job.total_processed)}</div>
          <div class="text-sm text-gray-500">Processed</div>
          <div class="text-xs text-gray-400">${formatNumber(job.total_permutations)} total</div>
        </div>
        
        <div class="bg-white p-6 rounded-lg shadow" data-found>
          <div class="text-2xl font-bold text-purple-600">${formatNumber(job.total_found)}</div>
          <div class="text-sm text-gray-500">Found</div>
          <div class="text-xs text-gray-400">Results</div>
        </div>
      </div>
      
      <!-- Chunk Statistics -->
      <div class="bg-white rounded-lg shadow-lg p-6 mb-8">
        <h2 class="text-lg font-semibold mb-4">Chunk Statistics</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4" data-chunk-stats>
          ${chunkStatsHtml}
        </div>
      </div>
      
      <!-- Job Details -->
      <div class="bg-white rounded-lg shadow-lg p-6 mb-8">
        <h2 class="text-lg font-semibold mb-4">Job Details</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><strong>Created:</strong> ${new Date(job.created_at).toLocaleString()}</div>
          <div><strong>Chunk Size:</strong> ${formatNumber(job.chunk_size)}</div>
          <div><strong>Priority:</strong> ${job.priority}</div>
          <div><strong>Total Chunks:</strong> ${formatNumber(job.total_chunks)}</div>
          ${job.started_at ? `<div><strong>Started:</strong> ${new Date(job.started_at).toLocaleString()}</div>` : ''}
          ${job.completed_at ? `<div><strong>Completed:</strong> ${new Date(job.completed_at).toLocaleString()}</div>` : ''}
          ${job.created_by ? `<div><strong>Created By:</strong> ${job.created_by}</div>` : ''}
          ${job.notes ? `<div class="md:col-span-2"><strong>Notes:</strong> ${job.notes}</div>` : ''}
        </div>
      </div>
      
      <!-- Found Results -->
      <div class="bg-white rounded-lg shadow-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-semibold">Found Results</h2>
          <div class="text-sm text-gray-500">Latest ${foundResults.length} results</div>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Seed Phrase</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Found At</th>
              </tr>
            </thead>
            <tbody class="bg-white">
              ${foundResultsHtml}
            </tbody>
          </table>
        </div>
      </div>
      
      <script>
        function resumeJob(jobId) {
          if (confirm('Resume this job?')) {
            fetch('/api/jobs/' + jobId + '/resume', { method: 'POST' })
              .then(r => r.ok ? location.reload() : alert('Failed to resume job'))
              .catch(() => alert('Failed to resume job'));
          }
        }
        function pauseJob(jobId) {
          if (confirm('Pause this job?')) {
            fetch('/api/jobs/' + jobId + '/pause', { method: 'POST' })
              .then(r => r.ok ? location.reload() : alert('Failed to pause job'))
              .catch(() => alert('Failed to pause job'));
          }
        }
        function deleteJob(jobId) {
          if (confirm('Are you sure you want to delete this job? This action cannot be undone.')) {
            fetch('/api/jobs/' + jobId, { method: 'DELETE' })
              .then(r => r.ok ? (window.location.href = '/jobs') : alert('Failed to delete job'))
              .catch(() => alert('Failed to delete job'));
          }
        }
        
        // Real-time job progress updates
        let lastJobState = null;
        let lastProgress = 0; // Track last progress to prevent regression
        
        function updateJobProgress() {
          const jobId = '${job.id}';
          fetch('/api/jobs/' + jobId + '/progress')
            .then(r => r.json())
            .then(data => {
              // Stabilize progress calculation
              if (data.total_permutations > 0) {
                const rawProgress = (data.total_processed / data.total_permutations) * 100;
                // Ensure progress only moves forward (unless job is reset/restarted)
                data.calculated_progress = Math.max(0, Math.min(100, rawProgress));
                if (data.status === 'running' || data.status === 'processing') {
                  data.calculated_progress = Math.max(lastProgress, data.calculated_progress);
                }
                lastProgress = data.calculated_progress;
              } else {
                data.calculated_progress = 0;
              }
              
              const currentState = JSON.stringify(data);
              if (currentState !== lastJobState) {
                lastJobState = currentState;
                updateJobDisplay(data);
              }
            })
            .catch(err => console.error('Failed to fetch job progress:', err));
        }
        
        function updateJobDisplay(job) {
          // Update status
          const statusElement = document.querySelector('[data-status]');
          if (statusElement) {
            const statusIcon = job.status === 'completed' ? '✅' : job.status === 'running' ? '🏃' : job.status === 'paused' ? '⏸️' : job.status === 'failed' ? '❌' : '📄';
            statusElement.innerHTML = \`
              <div class="flex items-center">
                <div class="text-2xl mr-2">\${statusIcon}</div>
                <div>
                  <div class="text-lg font-semibold capitalize">\${job.status}</div>
                  <div class="text-sm text-gray-500">Status</div>
                </div>
              </div>
            \`;
          }
          
          // Update progress using stabilized calculation
          const progress = job.calculated_progress || 0;
          const progressElement = document.querySelector('[data-progress]');
          if (progressElement) {
            progressElement.innerHTML = \`
              <div class="text-2xl font-bold text-blue-600">\${progress.toFixed(2)}%</div>
              <div class="text-sm text-gray-500">Progress</div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div class="bg-blue-600 h-2 rounded-full transition-all duration-500" style="width: \${progress}%"></div>
              </div>
            \`;
          }
          
          // Update processed count
          const processedElement = document.querySelector('[data-processed]');
          if (processedElement) {
            processedElement.innerHTML = \`
              <div class="text-2xl font-bold text-green-600">\${formatNumber(job.total_processed)}</div>
              <div class="text-sm text-gray-500">Processed</div>
              <div class="text-xs text-gray-400">\${formatNumber(job.total_permutations)} total</div>
            \`;
          }
          
          // Update found count
          const foundElement = document.querySelector('[data-found]');
          if (foundElement) {
            foundElement.innerHTML = \`
              <div class="text-2xl font-bold text-purple-600">\${formatNumber(job.total_found)}</div>
              <div class="text-sm text-gray-500">Found</div>
              <div class="text-xs text-gray-400">Results</div>
            \`;
          }
          
          // Update chunk statistics
          const chunkStatsElement = document.querySelector('[data-chunk-stats]');
          if (chunkStatsElement && job.chunk_stats) {
            chunkStatsElement.innerHTML = job.chunk_stats.map(chunk => \`
              <div class="bg-gray-50 px-4 py-3 rounded-lg">
                <div class="text-sm font-medium capitalize">\${chunk.status}</div>
                <div class="text-lg font-bold">\${formatNumber(chunk.count)}</div>
                <div class="text-xs text-gray-500">chunks</div>
              </div>
            \`).join('');
          }
          
          // Update action buttons based on status
          const actionsElement = document.querySelector('[data-actions]');
          if (actionsElement) {
            let buttons = '';
            if (job.status === 'pending' || job.status === 'paused') {
              buttons += \`<button onclick="resumeJob('\${job.id}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">Resume</button>\`;
            }
            if (job.status === 'running') {
              buttons += \`<button onclick="pauseJob('\${job.id}')" class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg">Pause</button>\`;
            }
            if (job.status === 'pending' || job.status === 'paused' || job.status === 'failed' || job.status === 'completed') {
              buttons += \`<button onclick="deleteJob('\${job.id}')" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg">Delete</button>\`;
            }
            buttons += \`<a href="/jobs" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">Back to Jobs</a>\`;
            actionsElement.innerHTML = buttons;
          }
        }
        
        function formatNumber(num) {
          return new Intl.NumberFormat().format(num);
        }
        
        // Start real-time updates
        updateJobProgress(); // Initial load
        setInterval(updateJobProgress, 1000); // Update every second
      </script>
    `;
    return c.html(renderLayout(`Job: ${job.name}`, content));
  });

  // Job progress API endpoint
  app.get('/api/jobs/:id/progress', (c) => {
    const jobId = c.req.param('id');
    
    // Get basic job info without the complex progress calculation
    const job = db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }
    
    // Calculate progress more reliably with separate queries
    const chunkProgress = db.db.prepare(`
      SELECT 
        COUNT(*) as total_chunks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_chunks,
        SUM(CASE WHEN status = 'processing' OR status = 'assigned' THEN 1 ELSE 0 END) as active_chunks,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_chunks,
        -- Only count completed chunks fully, processing chunks conservatively
        SUM(CASE 
          WHEN status = 'completed' THEN (stop_at - skip_count)
          WHEN status IN ('processing', 'assigned') THEN 
            CASE 
              WHEN processed_count < 0 THEN 0
              WHEN processed_count > (stop_at - skip_count) THEN (stop_at - skip_count)
              ELSE processed_count
            END
          ELSE 0 
        END) as calculated_processed,
        SUM(found_count) as calculated_found
      FROM work_chunks 
      WHERE job_id = ?
    `).get(jobId);
    
    // Get chunk statistics for the UI
    const chunks = db.db.prepare(`SELECT status, COUNT(*) as count FROM work_chunks WHERE job_id = ? GROUP BY status`).all(jobId);
    
    // Use the more stable calculated values
    const totalProcessed = chunkProgress?.calculated_processed || 0;
    const totalFound = chunkProgress?.calculated_found || 0;
    
    return c.json({
      id: job.id,
      name: job.name,
      status: job.status,
      total_permutations: job.total_permutations || 0,
      total_processed: Math.min(totalProcessed, job.total_permutations || 0), // Cap at total
      total_found: totalFound,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      total_chunks: chunkProgress?.total_chunks || 0,
      completed_chunks: chunkProgress?.completed_chunks || 0,
      active_chunks: chunkProgress?.active_chunks || 0,
      failed_chunks: chunkProgress?.failed_chunks || 0,
      chunk_stats: chunks.map(chunk => ({
        status: chunk.status,
        count: chunk.count
      }))
    });
  });

  // Dashboard data API endpoint
  app.get('/api/dashboard_data', (c) => {
    const stats = db.getOverallStats();
    const runningJobs = db.getAllJobs().filter(j => j.status === 'running').slice(0, 5);
    
    return c.json({
      stats: {
        total_jobs: stats?.total_jobs || 0,
        active_jobs: stats?.active_jobs || 0,
        online_workers: stats?.online_workers || 0,
        total_found: stats?.total_found || 0
      },
      running_jobs: runningJobs.map(job => ({
        id: job.id,
        name: job.name,
        status: job.status,
        total_permutations: job.total_permutations || 0,
        total_processed: job.total_processed || 0,
        total_found: job.total_found || 0
      }))
    });
  });

  // Legacy refresh endpoint
  app.get('/api/refresh', (c) => c.text('ok'));

  // API snippets for table refresh
  app.get('/api/workers_data', (c) => {
    const workers = db.getActiveWorkers();
    const html = workers.length === 0 ? '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">No workers connected</td></tr>' : workers.map(worker => {
      const isOnline = worker.actual_status !== 'offline';
      
      // Safe capability parsing
      let threads = 'Unknown';
      try {
        if (worker.capabilities && worker.capabilities !== '{}' && worker.capabilities !== '') {
          const capabilities = JSON.parse(worker.capabilities);
          threads = capabilities.threads || capabilities.thread_count || 'Unknown';
        }
      } catch (e) {
        threads = 'Unknown';
      }
      
      // Safe time calculation
      let timeDisplay = 'Unknown';
      try {
        const lastSeen = new Date(worker.last_heartbeat);
        if (!isNaN(lastSeen.getTime())) {
          const timeAgo = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
          if (timeAgo >= 0) {
            if (timeAgo < 60) {
              timeDisplay = `${timeAgo}s ago`;
            } else if (timeAgo < 3600) {
              timeDisplay = `${Math.floor(timeAgo/60)}m ago`;
            } else if (timeAgo < 86400) {
              timeDisplay = `${Math.floor(timeAgo/3600)}h ago`;
            } else {
              timeDisplay = `${Math.floor(timeAgo/86400)}d ago`;
            }
          }
        }
      } catch (e) {
        timeDisplay = 'Unknown';
      }
      
      return `
        <tr class="${isOnline ? 'bg-white' : 'bg-gray-50'}">
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center">
              <div class="w-3 h-3 rounded-full mr-3 ${isOnline ? 'bg-green-400' : 'bg-red-400'}"></div>
              <div>
                <div class="text-sm font-medium text-gray-900">${worker.id}</div>
                <div class="text-sm text-gray-500">${threads} threads</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap"><span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${worker.actual_status}</span></td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900"><div>Total: ${formatNumber(worker.total_processed)}</div><div class="text-xs text-gray-500">${(worker.average_rate || 0).toFixed(0)}/sec avg</div><div class="text-xs text-gray-500">Found: ${worker.total_found}</div></td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${worker.current_chunk_id ? `<span class=\"text-blue-600\">Working on chunk</span><br><code class=\"text-xs\">${worker.current_chunk_id.substring(0, 8)}...</code>` : '<span class=\"text-gray-400\">Idle</span>'}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${timeDisplay}</td>
        </tr>`;
    }).join('');
    return c.html(html);
  });

  app.get('/api/jobs_data', (c) => {
    const jobs = db.getAllJobs();
    const html = jobs.length === 0 ? '<tr><td colspan="6" class="px-6 py-8 text-center text-gray-500">No jobs found. <a href="/jobs/new" class="text-blue-600 hover:underline">Create your first job</a></td></tr>' : jobs.map(job => {
      const progress = job.total_permutations > 0 ? (job.total_processed / job.total_permutations * 100) : 0;
      const statusIcon = job.status === 'running' ? '🏃' : job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : job.status === 'paused' ? '⏸️' : '📄';
      return `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center"><span class="text-lg mr-2">${statusIcon}</span><div><div class="text-sm font-medium text-gray-900">${job.name}</div><div class="text-sm text-gray-500">Priority: ${job.priority}</div></div></div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap"><span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${job.status === 'completed' ? 'bg-green-100 text-green-800' : job.status === 'running' ? 'bg-blue-100 text-blue-800' : job.status === 'failed' ? 'bg-red-100 text-red-800' : job.status === 'paused' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}">${job.status}</span></td>
          <td class="px-6 py-4 whitespace-nowrap"><div class="text-sm text-gray-900">${formatNumber(job.total_processed)} / ${formatNumber(job.total_permutations || 0)}</div><div class="w-full bg-gray-2 00 rounded-full h-2 mt-1"><div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min(progress, 100)}%"></div></div><div class="text-xs text-gray-500 mt-1">${progress.toFixed(1)}%</div></td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatNumber(job.total_found)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(job.created_at).toLocaleDateString()}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium"><div class="flex space-x-2"><a href="/jobs/${job.id}" class="text-blue-600 hover:text-blue-900">View</a>${job.status === 'pending' || job.status === 'paused' ? `<button class=\"text-green-600 hover:text-green-900\" onclick=\"resumeJob('${job.id}')\">Resume</button>` : ''}${job.status === 'running' ? `<button class=\"text-yellow-600 hover:text-yellow-900\" onclick=\"pauseJob('${job.id}')\">Pause</button>` : ''}${job.status === 'pending' || job.status === 'paused' || job.status === 'failed' || job.status === 'completed' ? `<button class=\"text-red-600 hover:text-red-900\" onclick=\"deleteJob('${job.id}')\">Delete</button>` : ''}</div></td>
        </tr>`;
    }).join('');
    return c.html(html);
  });

  // Job management
  app.post('/api/jobs/:id/resume', (c) => {
    const jobId = c.req.param('id');
    try { db.updateJobStatus(jobId, 'pending'); return c.json({ success: true, message: 'Job resumed' }); } catch (e) { return c.json({ error: 'Failed to resume job' }, 500); }
  });
  app.post('/api/jobs/:id/pause', (c) => {
    const jobId = c.req.param('id');
    try {
      db.updateJobStatus(jobId, 'paused');
      db.db.prepare(`UPDATE work_chunks SET status = 'pending', assigned_to = NULL, assigned_at = NULL WHERE job_id = ? AND status = 'assigned'`).run(jobId);
      return c.json({ success: true, message: 'Job paused' });
    } catch (e) { return c.json({ error: 'Failed to pause job' }, 500); }
  });
  app.delete('/api/jobs/:id', (c) => {
    const jobId = c.req.param('id');
    try {
      const job = db.getJob(jobId);
      if (!job) return c.json({ error: 'Job not found' }, 404);
      if (job.status === 'running') return c.json({ error: 'Cannot delete running job. Pause it first.' }, 400);
      db.db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
      return c.json({ success: true, message: 'Job deleted' });
    } catch (e) { return c.json({ error: 'Failed to delete job' }, 500); }
  });

  // Web API - Create job (content negotiation)
  app.post('/api/jobs', async (c) => {
    const contentType = c.req.header('content-type') || '';
    let name, tokenfileContent, chunkSize, priority, createdBy, notes;
    
    let skipFirst;
    if (contentType.includes('application/json')) {
      // Handle JSON requests (from new form)
      const body = await c.req.json();
      name = body.name;
      tokenfileContent = body.tokenContent;
      chunkSize = parseInt(body.chunkSize) || 1000000;
      priority = parseInt(body.priority) || 0;
      skipFirst = parseInt(body.skipFirst) || 0;
      createdBy = body.createdBy || null;
      notes = body.notes || '';
    } else {
      // Handle form data requests (legacy/HTMX)
      const formData = await c.req.formData();
      name = formData.get('name');
      tokenfileContent = formData.get('tokenfile_content');
      chunkSize = parseInt(formData.get('chunk_size')) || 1000000;
      priority = parseInt(formData.get('priority')) || 0;
      skipFirst = parseInt(formData.get('skip_first')) || 0;
      createdBy = formData.get('created_by') || null;
      notes = formData.get('notes') || '';
    }
    
    if (!name || !tokenfileContent) {
      const errorMsg = '<div class="text-red-600">Name and token content are required</div>';
      return contentType.includes('application/json') 
        ? c.json({ error: 'Name and token content are required' })
        : c.html(errorMsg);
    }
    const jobId = db.createJob(name, tokenfileContent, chunkSize, priority, createdBy, notes);
    const expansionResult = await expandTokenContent(tokenfileContent);
    const totalPermutations = expansionResult.success ? expansionResult.totalPermutations : calculatePermutations(tokenfileContent);
    
    // Validate skipFirst parameter
    const validatedSkipFirst = Math.max(0, Math.min(skipFirst, totalPermutations));
    
    const chunkCount = db.createWorkChunksWithSkip(jobId, totalPermutations, chunkSize, validatedSkipFirst);
    db.db.prepare('UPDATE jobs SET total_permutations = ? WHERE id = ?').run(totalPermutations, jobId);
    const accept = (c.req.header('accept') || '').toLowerCase();
    if (accept.includes('text/html')) {
      return c.html(`<div class=\"text-center py-8\"><div class=\"text-green-600 text-6xl mb-4\"><i class=\"fas fa-check-circle\"></i></div><h2 class=\"text-2xl font-bold text-gray-900 mb-2\">Job Created Successfully!</h2><p class=\"text-gray-600 mb-4\">Created ${chunkCount} chunks for ${formatNumber(totalPermutations)} total permutations</p><div class=\"space-x-4\"><a href=\"/jobs/${jobId}\" class=\"bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg\">View Job</a><a href=\"/jobs\" class=\"bg-gray-600 hover:bg-gray-700 text-white px-6 py-2 rounded-lg\">All Jobs</a></div></div>`);
    }
    return c.json({ id: jobId, chunk_count: chunkCount, total_permutations: totalPermutations });
  });

  // Worker API
  app.post('/get_work', async (c) => {
    const body = await c.req.json();
    const workerId = body.worker_id;
    if (!workerId) return c.json({ error: 'worker_id required' }, 400);
    db.registerWorker(workerId, JSON.stringify(body.capabilities || {}));
    const chunk = db.getNextWorkChunk();
    if (!chunk) return c.body('', 204);
    const assigned = db.assignChunkToWorker(chunk.id, workerId);
    if (!assigned) return c.body('', 204);
    const job = db.getJob(chunk.job_id);
    const chunk_size = chunk.stop_at - chunk.skip_count;
    return c.json({ id: chunk.id, token_content: job.tokenfile_content, skip: chunk.skip_count, stop_at: chunk_size });
  });

  app.post('/work_status', async (c) => {
    const status = await c.req.json();
    const { work_id, processed, found, rate, completed, error, found_results } = status;
    const chunkStatus = completed ? 'completed' : error ? 'failed' : 'processing';
    db.updateChunkProgress(work_id, processed, found, chunkStatus);
    if (rate > 0) {
      const chunk = db.db.prepare('SELECT assigned_to FROM work_chunks WHERE id = ?').get(work_id);
      if (chunk) db.addProgressUpdate(work_id, chunk.assigned_to, processed, found, rate);
    }
    if (found_results && Array.isArray(found_results) && found_results.length > 0) {
      const chunk = db.db.prepare('SELECT job_id, assigned_to, skip_count, stop_at FROM work_chunks WHERE id = ?').get(work_id);
      if (chunk) {
        found_results.forEach(result => {
          if (result.seed_phrase && result.address) {
            db.addFoundResult(chunk.job_id, work_id, chunk.assigned_to, result.seed_phrase, result.address, chunk.skip_count, chunk.stop_at);
            console.log(`🎉 FOUND SEED PHRASE! Address: ${result.address}`);
          }
        });
      }
    }
    return c.json({ status: 'ok' });
  });
}



