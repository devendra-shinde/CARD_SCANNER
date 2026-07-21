#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Business Card OCR & Smart Contact Management app (CardVault). Current iteration:
  1) Fix Emergent-managed Google Sign-In (user reported it not working).
  2) Optimize Excel import — replace O(N×M) phone-suffix dedupe with bulk in-memory index.
  3) Refactor server.py (~1600 lines) into modular FastAPI APIRouters under /app/backend/routes/.

backend:
  - task: "Modular APIRouter refactor of server.py"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py + /app/backend/routes/*.py + /app/backend/deps.py + /app/backend/schemas.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Split the monolithic server.py into:
              - deps.py       (Mongo client, logger, helpers, constants)
              - schemas.py    (all Pydantic models)
              - routes/auth.py, contacts.py, ai.py, email_settings.py,
                templates.py, campaigns.py, analytics.py, billing.py,
                excel.py, whatsapp.py
              - server.py     (slim: mounts every router under /api + CORS)
            Smoke tested manually: /, /auth/signup, /auth/verify-otp,
            /auth/me, /contacts, /billing/status, /analytics all return
            expected 2xx responses. Needs full regression by testing_agent.

  - task: "Excel import performance — O(N×M) → O(N+M)"
    implemented: true
    working: "NA"
    file: "/app/backend/routes/excel.py (import_commit)"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Import commit now scans the user's contacts ONCE and builds
            in-memory email + phone-suffix indexes. Row lookups are O(1)
            and newly inserted rows are also registered in the index so
            duplicates INSIDE the same upload are treated as merges.

  - task: "Emergent Google Sign-In backend endpoint"
    implemented: true
    working: true
    file: "/app/backend/routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: |
            /auth/google-session endpoint unchanged from previous iteration
            (already verified). The user reported the FRONTEND flow was not
            working — the fix landed on the client side (race condition).

frontend:
  - task: "Emergent Google Sign-In frontend race condition"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/context/auth.tsx + /app/frontend/app/_layout.tsx + /app/frontend/src/components/google-auth-button.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: false
          agent: "user"
          comment: "User said Google Sign-In does not work."
        - working: "NA"
          agent: "main"
          comment: |
            Root cause: race between AuthProvider mount (calls /auth/me,
            gets 401, calls clearToken) and RouterGate's consumePendingWebSession
            (writes the JWT). Depending on which finished last, the just-set
            token was being wiped.

            Fix: moved consumePendingWebSession INTO AuthProvider's mount
            effect, running BEFORE the initial refresh() call. Removed the
            duplicate call in RouterGate. Also surfaced non-cancellation
            errors via Alert / window.alert on the GoogleAuthButton so
            failures are no longer silent.

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 6
  run_ui: false

test_plan:
  current_focus:
    - "Modular APIRouter refactor of server.py"
    - "Excel import performance — O(N×M) → O(N+M)"
    - "Emergent Google Sign-In frontend race condition"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "testing"
      message: |
        Iteration 6 — ALL GREEN. 32/32 pytest cases pass. Zero 5xx across
        the entire router surface post-refactor. Excel import commit for
        a 36-row workbook against a user with 15 existing contacts
        finished in 64.9 ms with imported=20 / updated=16 / failed=0 —
        16 updates split cleanly into 6 email-only + 6 phone-suffix +
        4 in-file duplicates, confirming the O(N+M) index works.
        Google Sign-In backend smoke: fake session_id → 401 as designed.
        Report: /app/test_reports/iteration_6.json (junit at
        /app/test_reports/pytest/pytest_iter6.xml). No code changes
        required by testing agent.

    - agent: "main"
      message: |
        Ran a big backend refactor + two targeted fixes. Please:
        1) Regression-test the FULL backend surface (auth, contacts CRUD,
           facets, duplicates, merge, recipient-status, OCR, AI, enrich,
           SMTP settings + accounts, templates, campaigns, analytics,
           billing status/checkout(503)/cancel/history, excel import
           (preview + commit) + export + template, whatsapp templates
           + generate-links). All endpoint paths and payloads are
           unchanged — only file locations moved.
        2) Verify the Excel import optimization: upload a workbook where
           several rows collide by phone-only or email-only with existing
           contacts, plus in-file duplicates. Confirm imported/updated/
           duplicate_removed counts match expectations and the endpoint
           doesn't time out.
        3) On frontend, verify that on web preview, tapping "Continue
           with Google" no longer silently fails. (Full OAuth roundtrip
           can't be automated in the sandbox but at least confirm the
           button surfaces an error dialog on failure and the auth
           context correctly consumes ?session_id=/#session_id= in URL.)
        Test creds live in /app/memory/test_credentials.md.