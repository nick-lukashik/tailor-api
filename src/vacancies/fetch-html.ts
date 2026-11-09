import type { ApplyField, ApplyFieldType } from './apply-form.js'

const NAMED: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    laquo: '«',
    raquo: '»',
    bull: '•',
    middot: '·',
    copy: '©',
    reg: '®',
    trade: '™',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
    deg: '°',
    times: '×',
    shy: '',
    zwnj: '',
    zwj: '',
}

const codePoint = (value: number) => {
    if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '�'
    return String.fromCodePoint(value)
}

/** HTML character references: the common named ones and every numeric one. */
export function decodeEntities(value: string): string {
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (match, entity: string) => {
        if (entity[0] === '#')
            return codePoint(
                entity[1] === 'x' || entity[1] === 'X'
                    ? Number.parseInt(entity.slice(2), 16)
                    : Number.parseInt(entity.slice(1), 10),
            )
        return NAMED[entity.toLowerCase()] ?? match
    })
}

const REMOVED = /<(script|style|noscript|template|svg|iframe|canvas|object|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const CHROME = /<(nav|footer|header|aside|form|button|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const BLOCK =
    /<\/?(p|div|section|article|main|h[1-6]|ul|ol|table|thead|tbody|tr|blockquote|pre|dl|dt|dd|figure|figcaption|address|details|summary)\b[^>]*>/gi

const withoutNoise = (html: string) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(REMOVED, ' ')

/** The inside of the first `<tag>` … last `</tag>`, when the page has one. */
function inner(html: string, tag: string): string | undefined {
    const open = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html)
    if (!open) return undefined
    const close = html.toLowerCase().lastIndexOf(`</${tag}`)
    if (close <= open.index) return undefined
    return html.slice(open.index + open[0].length, close)
}

function flatten(html: string): string {
    const text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<hr\b[^>]*>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<\/(td|th)\s*>/gi, ' ')
        .replace(BLOCK, '\n')
        .replace(/<[^>]*>/g, '')
    return decodeEntities(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v ]+/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .replace(/\n(- \n)+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** The text of an HTML fragment (a job description): lines and list items kept, tags and scripts gone. */
export function htmlToText(html: string): string {
    return flatten(withoutNoise(html))
}

/**
 * The readable text of a whole page: without scripts, styles, navigation,
 * header, footer, forms; the `<main>` or `<article>` when they hold enough of it.
 */
export function pageText(html: string): string {
    const body = inner(withoutNoise(html), 'body') ?? withoutNoise(html)
    const clean = body.replace(CHROME, '\n')
    for (const tag of [
        'main',
        'article',
    ]) {
        const part = inner(clean, tag)
        const text = part === undefined ? '' : flatten(part)
        if (text.length >= 200) return text
    }
    return flatten(clean)
}

export type JobPosting = {
    title: string
    company: string
    location: string
    description: string
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const typeIs = (node: Record<string, unknown>, type: string) => {
    const value = node['@type']
    return Array.isArray(value) ? value.includes(type) : value === type
}

function* nodes(value: unknown, depth = 0): Generator<Record<string, unknown>> {
    if (depth > 6 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
        for (const item of value) yield* nodes(item, depth + 1)
        return
    }
    const node = value as Record<string, unknown>
    yield node
    if (node['@graph']) yield* nodes(node['@graph'], depth + 1)
}

const placeOf = (value: unknown): string => {
    const first = Array.isArray(value) ? value[0] : value
    if (!first || typeof first !== 'object') return str(first)
    const address = (first as Record<string, unknown>).address
    if (!address || typeof address !== 'object') return str(address)
    const parts = address as Record<string, unknown>
    return [
        parts.addressLocality,
        parts.addressRegion,
        parts.addressCountry,
    ]
        .map(part => (part && typeof part === 'object' ? str((part as Record<string, unknown>).name) : str(part)))
        .filter(Boolean)
        .join(', ')
}

/** The first schema.org `JobPosting` of the page's JSON-LD blocks, its description as text. */
export function jsonLdJobPosting(html: string): JobPosting | undefined {
    const blocks = html.matchAll(
        /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi,
    )
    for (const [, json] of blocks) {
        let data: unknown
        try {
            data = JSON.parse((json ?? '').trim())
        } catch {
            continue
        }
        for (const node of nodes(data)) {
            if (!typeIs(node, 'JobPosting')) continue
            const raw = str(node.description)
            // Some sites escape the HTML of the description once more.
            const description = htmlToText(/&lt;\/?[a-z]/i.test(raw) ? decodeEntities(raw) : raw)
            if (!description) continue
            const organization = node.hiringOrganization
            return {
                title: decodeEntities(str(node.title)),
                company: decodeEntities(
                    organization && typeof organization === 'object'
                        ? str((organization as Record<string, unknown>).name)
                        : str(organization),
                ),
                location: placeOf(node.jobLocation),
                description,
            }
        }
    }
    return undefined
}

/** The vacancy as text: its title, company and location lines over the description. */
export function postingText(posting: Partial<JobPosting> & Pick<JobPosting, 'description'>): string {
    return [
        posting.title,
        posting.company,
        posting.location,
    ]
        .map(line => line?.trim())
        .filter(Boolean)
        .concat(
            posting.description.trim()
                ? [
                      '',
                      posting.description.trim(),
                  ]
                : [],
        )
        .join('\n')
        .trim()
}

// Apply forms in plain HTML

type Attributes = Record<string, string>

function attributesOf(source: string): Attributes {
    const attributes: Attributes = {}
    for (const match of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        const name = match[1]?.toLowerCase()
        if (!name) continue
        attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
    }
    return attributes
}

const REQUIRED_MARK = /\s*[*✱]\s*/g

const clean = (value: string) => decodeEntities(value).replace(/\s+/g, ' ').trim()

type Capture = {
    tag: string
    depth: number
    text: string
    /** A label around a radio or checkbox: the option's text, not a question. */
    option:
        | {
              name: string
              index: number
          }
        | undefined
}

type Draft = ApplyField & {
    /** For a group of radios or checkboxes. */
    group?: 'radio' | 'checkbox'
    optionValues: string[]
}

const INPUT_TYPES: Record<string, ApplyFieldType> = {
    text: 'text',
    email: 'text',
    tel: 'text',
    url: 'text',
    number: 'text',
    date: 'text',
    month: 'text',
    search: 'text',
    file: 'file',
}

const SKIPPED_INPUTS = new Set([
    'hidden',
    'submit',
    'button',
    'reset',
    'image',
    'password',
])

const isLabelClass = (attributes: Attributes) =>
    /(^|[\s_-])(label|question-title|field-label|application-label)($|[\s_-])/i.test(attributes.class ?? '')

/**
 * The fields of the page's `<form>` elements as plain HTML gives them (no
 * JavaScript): text inputs, text areas, selects, radio groups, checkboxes and
 * file inputs. A field's label is its `<label for>`, the label around it,
 * `aria-label`, the nearest label before it, its placeholder or its name.
 * Hidden inputs and buttons are left out. None without a form.
 */
export function formFields(html: string): ApplyField[] {
    const forms = [
        ...withoutNoise(html).matchAll(/<form\b[^>]*>([\s\S]*?)<\/form\s*>/gi),
    ].map(match => match[1] ?? '')
    if (forms.length === 0) return []
    const source = forms.join('\n')

    const labelsFor = new Map<string, string>()
    for (const match of source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi)) {
        const target = attributesOf(match[1] ?? '').for
        if (target) labelsFor.set(target, clean((match[2] ?? '').replace(/<[^>]*>/g, ' ')))
    }

    const drafts: Draft[] = []
    const byName = new Map<string, Draft>()
    const captures: Capture[] = []
    let lastLabel = ''
    let select: Draft | undefined
    let option: string | undefined

    const labelOf = (attributes: Attributes) => {
        const own = attributes.id ? labelsFor.get(attributes.id) : undefined
        const around = [
            ...captures,
        ]
            .reverse()
            .find(capture => capture.tag === 'label' && !capture.option)
        return (
            own
            || (around ? clean(around.text) : '')
            || clean(attributes['aria-label'] ?? '')
            || lastLabel
            || clean(attributes.placeholder ?? '')
            || clean(attributes.name ?? '')
        )
    }

    const add = (draft: Draft) => {
        const required = draft.required || /[*✱]/.test(draft.label)
        const field = {
            ...draft,
            label: draft.label.replace(REQUIRED_MARK, ' ').trim(),
            required,
        }
        drafts.push(field)
        byName.set(field.key, field)
        return field
    }

    for (const match of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>|([^<]+)/g)) {
        const [, closing, rawTag, rawAttributes, text] = match
        if (text !== undefined) {
            for (const capture of captures) capture.text += text
            if (option !== undefined) option += text
            continue
        }
        const tag = (rawTag ?? '').toLowerCase()
        const attributes = attributesOf(rawAttributes ?? '')
        if (closing) {
            if (tag === 'option' && select && option !== undefined) {
                select.options?.push(clean(option))
                option = undefined
            }
            if (tag === 'select') {
                if (select && option !== undefined) select.options?.push(clean(option))
                select = undefined
                option = undefined
            }
            const index = captures.findLastIndex(capture => capture.tag === tag)
            const capture = captures[index]
            if (!capture) continue
            capture.depth -= 1
            if (capture.depth > 0) continue
            captures.splice(index, 1)
            const label = clean(capture.text)
            if (capture.option) {
                const field = byName.get(capture.option.name)
                if (field?.options && label) field.options[capture.option.index] = label
            } else if (label) lastLabel = label
            continue
        }
        const isLabel = tag === 'label' || tag === 'legend' || isLabelClass(attributes)
        const same = captures.find(capture => capture.tag === tag)
        if (same) same.depth += 1
        else if (isLabel)
            captures.push({
                tag,
                depth: 1,
                text: '',
                option: undefined,
            })
        if (isLabel) continue
        if (tag === 'option' && select) {
            if (option !== undefined) select.options?.push(clean(option))
            option = attributes.value === '' ? undefined : ''
            continue
        }
        const name = attributes.name ?? attributes.id
        if (!name) continue
        const required = 'required' in attributes || attributes['aria-required'] === 'true'
        if (tag === 'textarea') {
            if (!byName.has(name))
                add({
                    key: name,
                    label: labelOf(attributes),
                    type: 'textarea',
                    required,
                    optionValues: [],
                })
            continue
        }
        if (tag === 'select') {
            select = byName.has(name)
                ? undefined
                : add({
                      key: name,
                      label: labelOf(attributes),
                      type: 'multiple' in attributes ? 'multiselect' : 'select',
                      required,
                      options: [],
                      optionValues: [],
                  })
            option = undefined
            continue
        }
        if (tag !== 'input') continue
        const type = (attributes.type ?? 'text').toLowerCase()
        if (SKIPPED_INPUTS.has(type)) continue
        if (type === 'radio' || type === 'checkbox') {
            const value = attributes.value ?? 'on'
            const existing = byName.get(name)
            const group =
                existing?.group === type
                    ? existing
                    : existing
                      ? undefined
                      : add({
                            key: name,
                            label: lastLabel || clean(attributes['aria-label'] ?? '') || name,
                            type: type === 'radio' ? 'select' : 'boolean',
                            required,
                            group: type,
                            options: [],
                            optionValues: [],
                        })
            if (!group?.options) continue
            group.required ||= required
            group.optionValues.push(value)
            group.options.push(value === 'on' ? '' : value)
            const around = [
                ...captures,
            ]
                .reverse()
                .find(capture => capture.tag === 'label')
            if (around && !around.option)
                around.option = {
                    name,
                    index: group.options.length - 1,
                }
            else if (attributes.id && labelsFor.has(attributes.id))
                group.options[group.options.length - 1] = labelsFor.get(attributes.id) ?? value
            continue
        }
        if (!byName.has(name))
            add({
                key: name,
                label: labelOf(attributes),
                type: INPUT_TYPES[type] ?? 'other',
                required,
                optionValues: [],
            })
    }

    return drafts.map(({ group, optionValues, ...field }) => {
        if (group === 'checkbox') {
            const options = (field.options ?? []).filter(Boolean)
            if (optionValues.length > 1)
                return {
                    ...field,
                    type: 'multiselect',
                    options,
                }
            const { options: _single, ...rest } = field
            return {
                ...rest,
                type: 'boolean',
                // A lone checkbox's own label is the question when it says more than "Yes".
                label: options[0] && (options[0].length > 20 || field.label === field.key) ? options[0] : field.label,
            }
        }
        if (field.options) {
            const options = field.options.filter(Boolean)
            return options.length > 0
                ? {
                      ...field,
                      options,
                  }
                : (({ options: _none, ...rest }) => rest)(field)
        }
        return field
    })
}
