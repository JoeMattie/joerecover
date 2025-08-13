// Shared UI helpers and layout

export function formatNumber(num) {
  if (num >= 10000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ${seconds%60}s`;
  const hours = Math.floor(seconds/3600);
  const mins = Math.floor((seconds%3600)/60);
  return `${hours}h ${mins}m`;
}

export function renderLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Wallet Recovery Server</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.3"></script>
  <script src="https://unpkg.com/alpinejs@3.14.7/dist/cdn.min.js" defer></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" rel="stylesheet">
  <link rel="icon" href="data:,">
</head>
<body class="bg-gray-100 min-h-screen">
  <nav class="bg-gray-900 text-white shadow-lg">
    <div class="container mx-auto px-4">
      <div class="flex justify-between items-center py-4">
        <div class="flex items-center">
          <i class="fas fa-key text-blue-400 mr-3 text-xl"></i>
          <h1 class="text-xl font-bold">Wallet Recovery Server</h1>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/" class="hover:text-blue-400 transition-colors">Dashboard</a>
          <a href="/jobs" class="hover:text-blue-400 transition-colors">Jobs</a>
          <a href="/workers" class="hover:text-blue-400 transition-colors">Workers</a>
          <button class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg" onclick="location.reload()">
            <i class="fas fa-sync-alt mr-2"></i>Refresh
          </button>
        </div>
      </div>
    </div>
  </nav>
  <main class="container mx-auto px-4 py-6">
    ${content}
  </main>
  <div hx-get="/api/refresh" hx-trigger="every 5s" hx-swap="none" style="display:none;"></div>
  <script>
    if (window.EventSource) {
      const es = new EventSource('/sse');
      let lastPath = location.pathname;
      let lastDashboardState = null;
      
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'refresh') {
            // Only soft-refresh fragments via HTMX where available
            if (lastPath === '/jobs') {
              fetch('/api/jobs_data').then(r => r.text()).then(html => {
                const tbody = document.getElementById('jobs-table-body'); if (tbody) tbody.innerHTML = html;
              });
            } else if (lastPath === '/workers') {
              fetch('/api/workers_data').then(r => r.text()).then(html => {
                const tbody = document.getElementById('workers-table-body'); if (tbody) tbody.innerHTML = html;
              });
            } else if (lastPath === '/') {
              // Smart dashboard updates - only refresh if data actually changed
              updateDashboard();
            }
          }
        } catch {}
      };
      
      function updateDashboard() {
        fetch('/api/dashboard_data')
          .then(r => r.json())
          .then(data => {
            const currentState = JSON.stringify(data);
            if (currentState !== lastDashboardState) {
              lastDashboardState = currentState;
              updateDashboardUI(data);
            }
          })
          .catch(() => {});
      }
      
      function updateDashboardUI(data) {
        // Update statistics cards
        if (data.stats) {
          const totalJobsEl = document.querySelector('[data-total-jobs]');
          if (totalJobsEl) totalJobsEl.textContent = data.stats.total_jobs || 0;
          
          const activeJobsEl = document.querySelector('[data-active-jobs]');
          if (activeJobsEl) activeJobsEl.textContent = data.stats.active_jobs || 0;
          
          const onlineWorkersEl = document.querySelector('[data-online-workers]');
          if (onlineWorkersEl) onlineWorkersEl.textContent = data.stats.online_workers || 0;
          
          const totalFoundEl = document.querySelector('[data-total-found]');
          if (totalFoundEl) totalFoundEl.textContent = formatNumber(data.stats.total_found || 0);
        }
        
        // Update running jobs list
        if (data.running_jobs) {
          const runningJobsEl = document.querySelector('[data-running-jobs]');
          if (runningJobsEl) {
            if (data.running_jobs.length === 0) {
              runningJobsEl.innerHTML = '<p class="text-gray-500 text-center py-8">No jobs currently running. <a href="/jobs/new" class="text-blue-600 hover:underline">Create a new job</a></p>';
            } else {
              runningJobsEl.innerHTML = data.running_jobs.map(job => {
                const progress = job.total_permutations > 0 ? (job.total_processed / job.total_permutations * 100) : 0;
                return \`<div class="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
                  <div class="flex-1">
                    <div class="flex items-center">
                      <span class="text-lg mr-2">🏃</span>
                      <a href="/jobs/\${job.id}" class="font-medium text-blue-600 hover:text-blue-800">\${job.name}</a>
                    </div>
                    <div class="mt-1">
                      <div class="w-full bg-gray-200 rounded-full h-2">
                        <div class="bg-blue-600 h-2 rounded-full transition-all duration-500" style="width: \${Math.min(progress, 100)}%"></div>
                      </div>
                      <p class="text-xs text-gray-500 mt-1">\${progress.toFixed(1)}% - \${formatNumber(job.total_processed)} / \${formatNumber(job.total_permutations)}</p>
                    </div>
                  </div>
                  <div class="text-right ml-4">
                    <p class="text-sm font-medium text-green-600">\${job.status}</p>
                    <p class="text-xs text-gray-500">Found: \${formatNumber(job.total_found)}</p>
                  </div>
                </div>\`;
              }).join('');
            }
          }
        }
      }
      
      function formatNumber(num) {
        return new Intl.NumberFormat().format(num);
      }
    }
  </script>
</body>
</html>`;
}


