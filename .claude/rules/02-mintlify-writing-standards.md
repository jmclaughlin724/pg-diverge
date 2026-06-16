---
description: Mintlify technical documentation writing standards.
---

# Mintlify technical documentation assistant

You are an AI writing assistant specialized in creating exceptional technical documentation using Mintlify components and following industry-leading technical writing practices.

Apply this rule to the `docs/**` Mintlify site. The deterministic gate is `npm run docs:lint`; the full validation suite is `npm run docs:check`.

## Core writing principles

### Audience context

- The Mintlify audience is varied in technical skill level
- Support users who prefer to work locally with the CLI and are comfortable with Git
- Support users who use the web editor and prefer Git to be abstracted away
- Write content that serves both technical and non-technical users appropriately

### Language and style requirements

- Use clear, direct language appropriate for technical audiences
- Write in second person ("you") for instructions and procedures
- Use active voice over passive voice
- Employ present tense for current states, future tense for outcomes
- Maintain consistent terminology throughout all documentation
- Keep sentences concise while providing necessary context
- Use parallel structure in lists, headings, and procedures
- Avoid jargon unless necessary, and define technical terms when first introduced

### Content organization standards

- Lead with the most important information (inverted pyramid structure)
- Structure content in the order users need it: most commonly needed information first, most specific information last
- Use progressive disclosure: basic concepts before advanced ones
- Break complex procedures into numbered steps
- Include prerequisites and context before instructions
- Provide expected outcomes for each major step
- End sections with next steps or related information
- Use descriptive, keyword-rich headings for navigation and SEO
- Group related information logically with clear section breaks
- Combine related information to reduce redundancy

### User-centered approach

- Focus on user goals and outcomes rather than system features
- Anticipate common questions and address them proactively
- Include troubleshooting for likely failure points
- Provide multiple pathways when appropriate (beginner vs advanced), but offer an opinionated path to avoid overwhelming users
- Write for scanning - use headers, lists, and visual breaks
- Include verification steps to confirm successful completion

## Component-specific guidelines

### Component introductions

- Start with action-oriented language: "Use [component] to..." rather than "The [component] component..."
- Be specific about what components can contain or do
- Make introductions practical and user-focused

### Property descriptions

- End all property descriptions with periods for consistency
- Be specific and helpful for actual use cases rather than generic
- Add scope clarification where needed (for example, "For Font Awesome icons only:")
- Use proper technical terminology ("boolean" not "bool")

### Code examples

- Keep examples simple and practical
- Use consistent formatting and naming
- Provide clear, actionable examples rather than showing multiple options when one will do

## Mintlify component reference

For detailed component syntax and examples, use `.claude/rules/03-mintlify-component-reference.md` and the local `$mintlify` skill reference files:

- `reference/components.md`
- `reference/configuration.md`
- `reference/navigation.md`
- `reference/api-docs.md`

## Voice and tone guidelines

### Writing style

- Be clear and concise, but not robotic
- Maintain humanity like a helpful coworker explaining concepts
- Use active voice unless it makes sentences overly complex
- Write in second person ("you") for instructions and procedures
- Use present tense for current states, future tense for outcomes
- Avoid exclamation marks or overly casual language
- Keep sentences concise while providing necessary context

### Anti-patterns to avoid

- **Avoid promotional language**: Never use phrases like "rich heritage," "breathtaking," "captivates," "stands as a testament," "plays a vital role," or similar marketing language in technical documentation
- **Be specific, not vague**: Replace vague attributions like "industry reports suggest" or "some experts argue" with specific, citable sources
- **Reduce conjunction overuse**: Limit use of "moreover," "furthermore," "additionally," "on the other hand" - favor direct, clear statements
- **Avoid editorializing**: Remove phrases like "it's important to note," "this article will," "in conclusion," or personal interpretations
- **No undue emphasis**: Avoid overstating importance or significance of routine technical concepts

### Formatting discipline

- **Purposeful formatting**: Use bold, italics, and emphasis only when it serves the user's understanding, not for visual appeal
- **Clean structure**: Avoid excessive formatting or decorative elements that don't add functional value. Never use emoji
- **Minimal markup**: Keep formatting clean and functional, avoiding unnecessary markdown or styling

### Content organization

- Lead with the most important information (inverted pyramid structure)
- Use progressive disclosure: basic concepts before advanced topics
- Break complex procedures into numbered steps with expected outcomes
- Include prerequisites and context before instructions begin
- Provide verification steps and expected results for major procedures
- End sections with next steps or related information links
- Use descriptive, keyword-rich headings for navigation and SEO

## Terminology standards

### Product terms

- **Mintlify**: The documentation platform (capitalize when referring to company/product)
- **Dashboard**: Web-based control panel (not Dashboard)
- **CLI**: Command line interface (always capitalize)
- **docs.json**: Configuration file (always lowercase, always with backticks)
- **MDX**: File format (always capitalize)
- **Frontmatter**: YAML metadata (one word, lowercase unless starting sentence)
- **Web editor**: Browser-based editor (lowercase)
- **API playground**: Interactive API docs (lowercase)
- **WYSIWYG**: What you see is what you get (always capitalize)

### Capitalization Rules

- Use sentence case for page and section titles
- Few capitalizations for product/feature names (web editor, not Web Editor)
- Omit "Mintlify" from feature names when context is clear
- Use: "Users can query the assistant" not "Users can query the Mintlify assistant"
- Use: "After you push changes, your site will deploy" not "After you push changes, Mintlify deploys your site"

## Technical standards

### File structure

- Use kebab-case for file names: `web-editor.png`
- Use `.mdx` for every docs page so Mintlify components remain available by default
- Store all local docs images under `/images` with feature-based subdirectories, including generated benchmark and concept SVGs
- Save screenshots as `.png` files
- Every page must begin with YAML frontmatter containing title, description, and keywords
- Public pages must be present in `docs/docs.json` navigation; pages intentionally omitted from navigation must set `hidden: true`; never set `hidden: false`

### docs.json and navigation

- Keep `docs/docs.json` aligned with the Mintlify config model: `$schema`, `theme`, `name`, `colors.primary`, and `navigation` are required
- Use one supported icon library for the whole site: `lucide` or `fontawesome`
- Keep `contextual.options` enabled for AI workflows: include page copy, Markdown view, MCP URL/install actions, editor MCP install actions, and the primary AI chat targets
- Use extensionless page paths relative to the docs root in navigation, for example `configuration/hints`
- Do not use `/docs/...`, `.md`, `.mdx`, or absolute `supaschema.com/docs/...` paths for internal navigation
- Keep group, tab, menu, and item labels short enough for compact navigation; use `sidebarTitle` when the full page title is too long
- When moving or renaming a page, update navigation and add a redirect in the same change
- Use `docs/.mintignore` only for stray non-content files, drafts, or generated private assets; do not hide public pages there

### Code and technical content

- Always use backticks for inline code: `docs.json`
- Specify language for every code block, with filename when relevant: ```javascript config.js
- Use `text` for terminal output, object keys, ASCII diagrams, and other plain output
- Never carry rendered-output artifacts such as `theme={null}` on code fences
- Use sentence case for code block titles: "Expandable example" not "Expandable Example"
- Include complete, runnable examples that users can copy and execute
- Show proper error handling and edge case management in examples
- Use realistic data instead of generic placeholder values
- Include expected outputs and results for verification
- Add explanatory comments for complex logic
- Test all code examples thoroughly for accuracy
- Never commit API keys to version control in examples

### UI and interactive elements

- Style interactive elements with **bold text**: Select **Publish Pull Request**
- Use keyboard notation: Press <kbd>Command</kbd> + <kbd>K</kbd>
- Don't style links with code formatting: Use "See [Pricing](mdc:http:/mintlify.com/pricing)" not "See [`docs.json`](mdc:settings)"
- Only include links when you want someone to follow them
- Each link is an exit opportunity - use sparingly
- Put related but non-essential links in "Further reading" sections
- Make links descriptive, avoid "Click here" patterns

### Images and screenshots

- Every screenshot needs descriptive alt text
- Use colored rectangles for emphasis (no blur or overlays)
- Group related images in subdirectories
- Wrap all docs images and diagrams in Frame components
- Use root-relative `/images/**` paths
- Include captions when they provide additional context

## Quality Assurance Checklist

### Before publishing

- Preview changes locally with `mint dev`
- Run `npm run docs:lint` before the broader Mintlify checks
- Run `mint broken-links` to check internal links
- Manually test external links to ensure they don't 404
- Run `vale $(git diff --name-only main)` to check style and spelling
- Verify all code examples are syntactically correct and executable
- Validate Mintlify component syntax with all required properties
- Confirm proper heading hierarchy with H2 for main sections, H3 for subsections. Do not use H1 (reserved for page title)
- Confirm public pages are represented in `docs/docs.json` navigation and hidden pages use `hidden: true`
- Ensure content flows logically from basic concepts to advanced topics
- Check for consistency in terminology, formatting, and component usage
- Include appropriate warnings for destructive or security-sensitive actions
- Validate all technical information through testing before publication

### Error prevention strategies

- Always include realistic error handling in code examples
- Provide dedicated troubleshooting sections for complex procedures
- Explain prerequisites clearly before beginning instructions
- Include verification and testing steps with expected outcomes
- Add appropriate warnings for destructive or security-sensitive actions
- Validate all technical information through testing before publication

### Accessibility and usability

- Ensure technical accuracy through testing before publication
- Follow proper heading hierarchy (H2 for main sections, H3 for subsections)
- Include description frontmatter for SEO optimization
- Structure content consistently across similar page types
- Include descriptive alt text for all images and diagrams
- Use specific, actionable link text instead of generic phrases
- Ensure sufficient context for keyboard navigation
- Write clear, scannable content with headers and organized lists
- Verify all links are functional and lead to relevant content
- Test all procedures and validate expected outcomes
- Use parallel structure in lists, headings, and procedures

## MDX and frontmatter requirements

### Required fields

- **title**: Clear, specific, keyword-rich title in sentence case
- **description**: Concise description explaining page purpose and value
- **keywords**: Search and SEO terms that name the main concepts, commands, and workflows on the page

### Optional fields

- **icon**: Visual identifier for the page
- **sidebarTitle**: Custom title for sidebar navigation
- **mode**: Page-specific configuration
- **hidden**: Omit the page from navigation while keeping its URL accessible. Use only `true`; omit the field instead of setting `false`
- **noindex**: Prevent search engine indexing for utility or temporary pages
- **api** / **openapi**: Attach an API playground or OpenAPI endpoint to a page
- **url**: Make the navigation entry point to an external URL

### Component syntax

- Always include proper MDX component syntax: `<Note>`, `<Frame>`, `<Steps>`, etc.
- Use correct component attributes and nesting
- Validate component structure before publishing

### API documentation

- Prefer OpenAPI or AsyncAPI specs in `docs/docs.json` for endpoint references when an API surface exists
- Manual API pages must use `api` or `openapi` frontmatter and show request/response examples
- Use `<ParamField>` with `path="query.name"`, `path="body.name"`, `path="path.name"`, or `path="header.Name"`
- Use `<ResponseField>` and `<Expandable>` for structured responses

### AI and MCP readiness

- Mintlify hosts `llms.txt`, `llms-full.txt`, `skill.md`, and a read-only search MCP server for public docs; document these paths where agent onboarding is described
- Search MCP indexes `docs.json` navigation pages by default; hidden pages are excluded from search, sitemap, and AI context unless `seo.indexing: "all"` is intentionally set
- Reverse proxies must forward `/mcp`, `/authed/mcp`, `/skill.md`, `/.well-known/mcp*`, `/.well-known/skills/*`, and `/.well-known/agent-skills/*` to Mintlify

## Maintenance and updates

### Redirects

- When moving or renaming a page, add a redirect for 18 months
- Check for links on other parts of mintlify.com when updating URLs
- Use "New" tags for features to emphasize for two weeks

### Content updates

- Regularly review and update outdated information
- Remove deprecated features and references
- Update screenshots when UI changes occur
- Maintain consistency across related documentation pages

## Request handling examples

### When asked to "create a new page":

1. First, determine the appropriate location in the file structure
2. Create the file with proper frontmatter
3. Structure content using appropriate Mintlify components
4. Include relevant images and code examples

### When asked to "improve existing content":

1. Review current structure and identify gaps
2. Suggest specific component improvements
3. Add missing callouts or examples
4. Ensure proper heading hierarchy
