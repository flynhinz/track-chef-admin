import { describe, it, expect } from 'vitest'
import { needsConfirm, firstKeyword, parseBulkUsersCsv, stripComments } from './sqlSafety'

describe('needsConfirm', () => {
  it('is false for simple SELECTs', () => {
    expect(needsConfirm('select * from profiles')).toBe(false)
    expect(needsConfirm('SELECT id FROM tenants LIMIT 10;')).toBe(false)
    expect(needsConfirm('with x as (select 1) select * from x')).toBe(false)
  })

  it('is true for UPDATE / DELETE / DDL', () => {
    expect(needsConfirm('update profiles set is_super_admin = true where email = ?')).toBe(true)
    expect(needsConfirm('DELETE FROM tenants WHERE id = 123')).toBe(true)
    expect(needsConfirm('drop table foo')).toBe(true)
    expect(needsConfirm('truncate app_events')).toBe(true)
    expect(needsConfirm('ALTER TABLE profiles ADD COLUMN x text')).toBe(true)
    expect(needsConfirm('insert into admin_builds (build_ref, title) values (?, ?)')).toBe(true)
    expect(needsConfirm('grant select on profiles to admin')).toBe(true)
    expect(needsConfirm('revoke all on profiles from public')).toBe(true)
    expect(needsConfirm('create table foo (id int)')).toBe(true)
  })

  it('ignores mutating keywords inside comments', () => {
    expect(needsConfirm('-- DELETE FROM profiles\nselect 1')).toBe(false)
    expect(needsConfirm('/* UPDATE foo */ select 1')).toBe(false)
  })

  it('detects mutations after a semicolon', () => {
    expect(needsConfirm('select 1; delete from app_events')).toBe(true)
  })

  it('does not false-positive on words containing mutation keywords', () => {
    expect(needsConfirm('select updated_at from profiles')).toBe(false)
    expect(needsConfirm('select deleted_at from profiles')).toBe(false)
    expect(needsConfirm('select created_at from profiles')).toBe(false)
  })
})

describe('firstKeyword', () => {
  it('returns uppercase first token, ignoring comments and whitespace', () => {
    expect(firstKeyword('select 1')).toBe('SELECT')
    expect(firstKeyword('  UPDATE x SET y = 1')).toBe('UPDATE')
    expect(firstKeyword('-- comment\n delete from x')).toBe('DELETE')
  })

  it('returns empty string for empty input', () => {
    expect(firstKeyword('')).toBe('')
    expect(firstKeyword('   ')).toBe('')
    expect(firstKeyword('-- only a comment')).toBe('')
  })
})

describe('stripComments', () => {
  it('removes line + block comments', () => {
    expect(stripComments('select 1 -- trailing')).toMatch(/select 1/)
    expect(stripComments('/* block */ select 1')).toMatch(/select 1/)
    expect(stripComments('-- full line')).not.toMatch(/full line/)
  })
})

describe('parseBulkUsersCsv', () => {
  it('parses valid rows', () => {
    const rows = parseBulkUsersCsv([
      'alice@example.com,Alice Smith,EG123456,,true',
      'bob@example.com,Bob Jones,EG123456,tenant-abc,false',
    ].join('\n'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      email: 'alice@example.com',
      display_name: 'Alice Smith',
      password: 'EG123456',
      tenant_id: null,
      must_reset: true,
    })
    expect(rows[1].tenant_id).toBe('tenant-abc')
    expect(rows[1].must_reset).toBe(false)
  })

  it('ignores blank lines and # comments', () => {
    const rows = parseBulkUsersCsv(`
      # header comment
      alice@example.com,Alice,EG123456,,true

      # another
      bob@example.com,Bob,EG123456,,false
    `)
    expect(rows).toHaveLength(2)
  })

  it('trims whitespace around fields', () => {
    const rows = parseBulkUsersCsv('  alice@example.com , Alice , EG123456 , , true  ')
    expect(rows[0].email).toBe('alice@example.com')
    expect(rows[0].display_name).toBe('Alice')
    expect(rows[0].must_reset).toBe(true)
  })

  it('handles missing trailing fields as defaults', () => {
    const rows = parseBulkUsersCsv('alice@example.com,Alice,EG123456')
    expect(rows[0].tenant_id).toBe(null)
    expect(rows[0].must_reset).toBe(false)
  })

  it('treats any non-"true" must_reset value as false', () => {
    const rows = parseBulkUsersCsv([
      'a@x.com,A,pw,,TRUE',
      'b@x.com,B,pw,,yes',
      'c@x.com,C,pw,,1',
    ].join('\n'))
    expect(rows[0].must_reset).toBe(true)
    expect(rows[1].must_reset).toBe(false)
    expect(rows[2].must_reset).toBe(false)
  })
})
