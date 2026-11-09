/**
 * Small answers of the ATS APIs and pages the vacancy fetch reads, in their
 * real shapes with made-up content (Example Labs, example.com).
 */

/** GET boards-api.greenhouse.io/v1/boards/examplelabs/jobs/4012345?questions=true */
export const greenhouseJob = {
    id: 4012345,
    title: 'Senior Backend Engineer',
    company_name: 'Example Labs',
    absolute_url: 'https://boards.greenhouse.io/examplelabs/jobs/4012345',
    location: {
        name: 'Remote, EU',
    },
    updated_at: '2026-11-01T10:00:00-04:00',
    content:
        '&lt;p&gt;Example Labs builds tools for &lt;strong&gt;logistics&lt;/strong&gt;.&lt;/p&gt;&lt;h3&gt;What you will do&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Build the order API in Node.js&lt;/li&gt;&lt;li&gt;Keep the checkout fast&amp;nbsp;&amp;amp; reliable&lt;/li&gt;&lt;/ul&gt;',
    questions: [
        {
            required: true,
            label: 'First Name',
            description: null,
            fields: [
                {
                    name: 'first_name',
                    type: 'input_text',
                    values: [],
                },
            ],
        },
        {
            required: true,
            label: 'Last Name',
            description: null,
            fields: [
                {
                    name: 'last_name',
                    type: 'input_text',
                    values: [],
                },
            ],
        },
        {
            required: true,
            label: 'Email',
            description: null,
            fields: [
                {
                    name: 'email',
                    type: 'input_text',
                    values: [],
                },
            ],
        },
        {
            required: true,
            label: 'Resume/CV',
            description: null,
            fields: [
                {
                    name: 'resume',
                    type: 'input_file',
                    values: [],
                },
                {
                    name: 'resume_text',
                    type: 'textarea',
                    values: [],
                },
            ],
        },
        {
            required: false,
            label: 'LinkedIn Profile',
            description: null,
            fields: [
                {
                    name: 'question_30000001',
                    type: 'input_text',
                    values: [],
                },
            ],
        },
        {
            required: true,
            label: 'Will you now or in the future require visa sponsorship?',
            description: null,
            fields: [
                {
                    name: 'question_30000002',
                    type: 'multi_value_single_select',
                    values: [
                        {
                            label: 'Yes',
                            value: 1,
                        },
                        {
                            label: 'No',
                            value: 0,
                        },
                    ],
                },
            ],
        },
        {
            required: true,
            label: 'Why do you want to work at Example Labs?',
            description: null,
            fields: [
                {
                    name: 'question_30000003',
                    type: 'textarea',
                    values: [],
                },
            ],
        },
        {
            required: false,
            label: 'Which of these have you used in production?',
            description: null,
            fields: [
                {
                    name: 'question_30000004',
                    type: 'multi_value_multi_select',
                    values: [
                        {
                            label: 'Node.js',
                            value: 11,
                        },
                        {
                            label: 'Go',
                            value: 12,
                        },
                        {
                            label: 'Kubernetes',
                            value: 13,
                        },
                    ],
                },
            ],
        },
        {
            required: false,
            label: 'Internal',
            description: null,
            fields: [
                {
                    name: 'internal_token',
                    type: 'input_hidden',
                    values: [],
                },
            ],
        },
    ],
}

/** GET apply.workable.com/api/v2/accounts/examplelabs/jobs/AB12CD34EF */
export const workableJob = {
    id: 'abc',
    shortcode: 'AB12CD34EF',
    title: 'Platform Engineer',
    location: {
        city: 'Example City',
        region: null,
        country: 'Exampleland',
    },
    workplace: 'hybrid',
    description: '<p>Example Labs runs a <b>delivery</b> platform.</p>',
    requirements: '<ul><li>Kubernetes</li><li>PostgreSQL</li></ul>',
    benefits: '<p>Four-day week.</p>',
}

/** GET apply.workable.com/api/v2/accounts/examplelabs/jobs/AB12CD34EF/form */
export const workableFormAnswer = [
    {
        name: 'Personal information',
        fields: [
            {
                id: 'firstname',
                label: 'First name',
                type: 'text',
                required: true,
            },
            {
                id: 'email',
                label: 'Email',
                type: 'email',
                required: true,
            },
            {
                id: 'resume',
                label: 'Resume',
                type: 'file',
                required: true,
            },
        ],
    },
    {
        name: 'Questions',
        fields: [
            {
                id: 'QA_5001',
                label: 'What is your notice period?',
                type: 'free_text',
                required: false,
            },
            {
                id: 'QA_5002',
                label: 'Are you willing to work from our office twice a week?',
                type: 'boolean',
                required: true,
            },
            {
                id: 'QA_5003',
                label: 'Preferred start',
                type: 'multiple_choice',
                singleAnswer: true,
                required: false,
                choices: [
                    {
                        id: 1,
                        body: 'Within a month',
                    },
                    {
                        id: 2,
                        body: 'Later',
                    },
                ],
            },
        ],
    },
]

/** GET api.lever.co/v0/postings/examplelabs/0b9e5c4e-1111-4a2b-9c3d-000000000001 */
export const leverPosting = {
    id: '0b9e5c4e-1111-4a2b-9c3d-000000000001',
    text: 'Frontend Engineer',
    categories: {
        location: 'Remote',
        commitment: 'Full-time',
        team: 'Web',
    },
    description: '<div>Example Labs ships a web app for couriers.</div>',
    descriptionPlain: 'Example Labs ships a web app for couriers.',
    lists: [
        {
            text: 'Requirements',
            content: '<li>React</li><li>TypeScript</li>',
        },
    ],
    additional: '<div>We hire worldwide.</div>',
    additionalPlain: 'We hire worldwide.',
    hostedUrl: 'https://jobs.lever.co/examplelabs/0b9e5c4e-1111-4a2b-9c3d-000000000001',
}

/** jobs.lever.co/examplelabs/<id>/apply: the form as plain HTML gives it. */
export const leverApplyPage = `<!doctype html><html><body>
<form method="POST" enctype="multipart/form-data" id="application-form">
  <input type="hidden" name="accountId" value="x">
  <ul>
    <li class="application-question resume">
      <div class="application-label">Resume/CV<span class="required">✱</span></div>
      <div class="application-field"><input type="file" name="resume"></div>
    </li>
    <li class="application-question">
      <label><div class="application-label">Full name<span class="required">✱</span></div>
      <div class="application-field"><input type="text" name="name" required></div></label>
    </li>
    <li class="application-question">
      <label for="email-input">Email</label>
      <input id="email-input" type="email" name="email" required>
    </li>
    <li class="application-question">
      <div class="application-label">LinkedIn URL</div>
      <input type="text" name="urls[LinkedIn]">
    </li>
  </ul>
  <div class="application-question custom-question">
    <div class="application-label"><div class="text">Do you have experience with React Native?<span class="required">✱</span></div></div>
    <ul>
      <li><label><input type="radio" name="cards[c1][field0]" value="Yes" required><span>Yes</span></label></li>
      <li><label><input type="radio" name="cards[c1][field0]" value="No"><span>No</span></label></li>
    </ul>
  </div>
  <div class="application-question custom-question">
    <div class="application-label">Which time zones can you cover?</div>
    <label><input type="checkbox" name="cards[c2][field0]" value="Europe">Europe</label>
    <label><input type="checkbox" name="cards[c2][field0]" value="Americas">Americas</label>
  </div>
  <div class="application-question">
    <div class="application-label">Additional information</div>
    <textarea name="comments" placeholder="Add a cover letter"></textarea>
  </div>
  <select name="eeo[gender]"><option value="">Select</option><option>Female</option><option>Male</option><option>Decline to self-identify</option></select>
  <button type="submit">Submit application</button>
</form>
</body></html>`

/** GET api.ashbyhq.com/posting-api/job-board/examplelabs?includeCompensation=true */
export const ashbyBoard = {
    apiVersion: '1',
    jobs: [
        {
            id: '5a1b2c3d-0000-4000-8000-000000000001',
            title: 'Data Engineer',
            location: 'Remote',
            employmentType: 'FullTime',
            descriptionPlain: 'Example Labs moves data for couriers.',
            descriptionHtml: '<p>Example Labs moves data for couriers.</p>',
            compensation: {
                compensationTierSummary: 'EUR 70K – 90K',
            },
        },
        {
            id: '5a1b2c3d-0000-4000-8000-000000000002',
            title: 'Designer',
            descriptionPlain: 'Another job.',
        },
    ],
}

/** A careers page of its own with a JSON-LD `JobPosting`. */
export const jobPostingPage = `<!doctype html><html><head>
<title>Careers</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Example Labs"},{"@type":"JobPosting","title":"Site Reliability Engineer","hiringOrganization":{"@type":"Organization","name":"Example Labs"},"jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Example City","addressCountry":"EX"}},"description":"&lt;p&gt;Keep the platform up.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;On-call&lt;/li&gt;&lt;/ul&gt;"}]}</script>
<style>body { color: red }</style>
</head><body><nav>Home Jobs About</nav><main><h1>Site Reliability Engineer</h1><p>Short teaser.</p></main><footer>© Example Labs</footer></body></html>`

/** A careers page without JSON-LD: the main content is the vacancy. */
export const plainJobPage = `<!doctype html><html><head><title>Job</title><script>window.x = 1</script></head>
<body>
<header><a href="/">Example Labs</a></header>
<nav><a href="/jobs">All jobs</a></nav>
<main>
<h1>QA Engineer</h1>
<p>Example Labs is looking for a QA engineer to keep releases calm.</p>
<h2>Requirements</h2>
<ul><li>Playwright</li><li>CI pipelines</li><li>Clear bug reports and a sense of what matters to the people who use the product</li></ul>
</main>
<form action="/search"><input name="q" placeholder="Search"></form>
<footer>Privacy · Terms</footer>
</body></html>`
