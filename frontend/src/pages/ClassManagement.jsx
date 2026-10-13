import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateClient } from 'aws-amplify/api'
import { signOut } from 'aws-amplify/auth'
import { getCurrentUserContext } from '../lib/auth'

const client = generateClient()

const listTeachersQuery = /* GraphQL */ `
  query ListTeachersBySchool($schoolId: ID, $nextToken: String) {
    listTeachers(filter: { school_id: { eq: $schoolId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
        email
        phone_number
      }
      nextToken
    }
  }
`

const createTeacherAccountMutation = /* GraphQL */ `
  mutation CreateTeacherAccount($input: CreateTeacherAccountInput!) {
    createTeacherAccount(input: $input) {
      teacher_id
      phone_number
      temporary_password
    }
  }
`

const listClassesBySchoolQuery = /* GraphQL */ `
  query ListClassesBySchoolAdmin($schoolId: ID, $nextToken: String) {
    listClasses(filter: { school_id: { eq: $schoolId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        name
        grade
        stream
        teacher_id
      }
      nextToken
    }
  }
`

const createClassMutation = /* GraphQL */ `
  mutation CreateClass($input: CreateClassInput!) {
    createClass(input: $input) {
      id
      name
      grade
      stream
      teacher_id
    }
  }
`

const updateClassTeacherMutation = /* GraphQL */ `
  mutation UpdateClassTeacher($input: UpdateClassInput!) {
    updateClass(input: $input) {
      id
      teacher_id
    }
  }
`

const deleteClassMutation = /* GraphQL */ `
  mutation DeleteClass($input: DeleteClassInput!) {
    deleteClass(input: $input) {
      id
    }
  }
`

const updateTeacherMutation = /* GraphQL */ `
  mutation UpdateTeacher($input: UpdateTeacherInput!) {
    updateTeacher(input: $input) {
      id
      first_name
      last_name
      email
      phone_number
    }
  }
`

const deleteTeacherMutation = /* GraphQL */ `
  mutation DeleteTeacher($input: DeleteTeacherInput!) {
    deleteTeacher(input: $input) {
      id
    }
  }
`

const updateClassMutation = /* GraphQL */ `
  mutation UpdateClassDetails($input: UpdateClassInput!) {
    updateClass(input: $input) {
      id
      name
      grade
      stream
    }
  }
`

const countStudentsInClassQuery = /* GraphQL */ `
  query CountStudentsInClass($classId: ID, $nextToken: String) {
    listStudents(filter: { class_id: { eq: $classId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
      }
      nextToken
    }
  }
`

const listAllSchoolStudentsQuery = /* GraphQL */ `
  query ListAllSchoolStudentsAdmin($schoolId: ID, $nextToken: String) {
    listStudents(filter: { school_id: { eq: $schoolId } }, limit: 100, nextToken: $nextToken) {
      items {
        id
        first_name
        last_name
        class_id
        status
      }
      nextToken
    }
  }
`

const moveStudentMutation = /* GraphQL */ `
  mutation MoveStudent($input: UpdateStudentInput!) {
    updateStudent(input: $input) {
      id
      class_id
    }
  }
`

const createStudentWithClassMutation = /* GraphQL */ `
  mutation CreateStudentWithClass($input: CreateStudentInput!) {
    createStudent(input: $input) {
      id
      first_name
      last_name
      class_id
    }
  }
`

export default function ClassManagement() {
  const navigate = useNavigate()
  const [schoolId, setSchoolId] = useState(null)

  const [teachers, setTeachers] = useState([])
  const [teachersLoading, setTeachersLoading] = useState(true)
  const [teachersError, setTeachersError] = useState('')
  const [newTeacherFirstName, setNewTeacherFirstName] = useState('')
  const [newTeacherLastName, setNewTeacherLastName] = useState('')
  const [newTeacherEmail, setNewTeacherEmail] = useState('')
  const [newTeacherPhone, setNewTeacherPhone] = useState('')
  const [addingTeacher, setAddingTeacher] = useState(false)
  const [addTeacherError, setAddTeacherError] = useState('')
  const [editingTeacherId, setEditingTeacherId] = useState(null)
  const [editTeacherFirstName, setEditTeacherFirstName] = useState('')
  const [editTeacherLastName, setEditTeacherLastName] = useState('')
  const [editTeacherEmail, setEditTeacherEmail] = useState('')
  const [savingTeacherId, setSavingTeacherId] = useState(null)
  const [deletingTeacherId, setDeletingTeacherId] = useState(null)
  const [teacherActionError, setTeacherActionError] = useState('')

  const [classes, setClasses] = useState([])
  const [classesLoading, setClassesLoading] = useState(true)
  const [classesError, setClassesError] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const [newClassGrade, setNewClassGrade] = useState('')
  const [newClassStream, setNewClassStream] = useState('')
  const [newClassTeacherId, setNewClassTeacherId] = useState('')
  const [addingClass, setAddingClass] = useState(false)
  const [addClassError, setAddClassError] = useState('')
  const [reassigningClassId, setReassigningClassId] = useState(null)
  const [deletingClassId, setDeletingClassId] = useState(null)
  const [classActionError, setClassActionError] = useState('')
  const [editingClassId, setEditingClassId] = useState(null)
  const [editClassName, setEditClassName] = useState('')
  const [editClassGrade, setEditClassGrade] = useState('')
  const [editClassStream, setEditClassStream] = useState('')
  const [savingClassId, setSavingClassId] = useState(null)

  const [allStudents, setAllStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [studentsError, setStudentsError] = useState('')
  const [movingStudentId, setMovingStudentId] = useState(null)
  const [selectedStudentIds, setSelectedStudentIds] = useState([])
  const [bulkTargetClassId, setBulkTargetClassId] = useState('')
  const [bulkMoving, setBulkMoving] = useState(false)
  const [newStudentFirstName, setNewStudentFirstName] = useState('')
  const [newStudentLastName, setNewStudentLastName] = useState('')
  const [newStudentPhone, setNewStudentPhone] = useState('')
  const [newStudentClassId, setNewStudentClassId] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)
  const [studentActionError, setStudentActionError] = useState('')

  const loadTeachers = useCallback(async (resolvedSchoolId) => {
    if (!resolvedSchoolId) return
    setTeachersLoading(true)
    setTeachersError('')
    try {
      const res = await client.graphql({ query: listTeachersQuery, variables: { schoolId: resolvedSchoolId } })
      setTeachers(res.data.listTeachers.items)
    } catch (err) {
      console.error('Failed to load teachers:', err)
      setTeachersError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setTeachersLoading(false)
    }
  }, [])

  const loadClasses = useCallback(async (resolvedSchoolId) => {
    if (!resolvedSchoolId) return
    setClassesLoading(true)
    setClassesError('')
    try {
      const res = await client.graphql({ query: listClassesBySchoolQuery, variables: { schoolId: resolvedSchoolId } })
      setClasses(res.data.listClasses.items)
    } catch (err) {
      console.error('Failed to load classes:', err)
      setClassesError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setClassesLoading(false)
    }
  }, [])

  const loadAllStudents = useCallback(async (resolvedSchoolId) => {
    if (!resolvedSchoolId) return
    setStudentsLoading(true)
    setStudentsError('')
    try {
      let items = []
      let nextToken = null
      do {
        const res = await client.graphql({
          query: listAllSchoolStudentsQuery,
          variables: { schoolId: resolvedSchoolId, nextToken },
        })
        items = items.concat(res.data.listStudents.items)
        nextToken = res.data.listStudents.nextToken
      } while (nextToken)
      items.sort((a, b) => a.first_name.localeCompare(b.first_name))
      setAllStudents(items)
    } catch (err) {
      console.error('Failed to load students:', err)
      setStudentsError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setStudentsLoading(false)
    }
  }, [])

  useEffect(() => {
    async function resolveAndLoad() {
      try {
        const { schoolId: sid } = await getCurrentUserContext()
        setSchoolId(sid)
        await Promise.all([loadTeachers(sid), loadClasses(sid), loadAllStudents(sid)])
      } catch (err) {
        console.error('Failed to resolve school context:', err)
        setTeachersError(err.message)
        setClassesError(err.message)
        setStudentsError(err.message)
        setTeachersLoading(false)
        setClassesLoading(false)
        setStudentsLoading(false)
      }
    }
    resolveAndLoad()
  }, [loadTeachers, loadClasses, loadAllStudents])

  async function handleAddTeacher(e) {
    e.preventDefault()
    setAddingTeacher(true)
    setAddTeacherError('')
    try {
      const res = await client.graphql({
        query: createTeacherAccountMutation,
        variables: {
          input: {
            school_id: schoolId,
            first_name: newTeacherFirstName,
            last_name: newTeacherLastName,
            email: newTeacherEmail || null,
            phone_number: newTeacherPhone,
          },
        },
      })
      const { phone_number, temporary_password } = res.data.createTeacherAccount
      window.alert(
        `Teacher account created.\n\nPhone: ${phone_number}\nTemporary password: ${temporary_password}\n\n`
        + `Give this password to the teacher directly. They will be asked to set their own password the first time they log in.`
      )
      setNewTeacherFirstName('')
      setNewTeacherLastName('')
      setNewTeacherEmail('')
      setNewTeacherPhone('')
      await loadTeachers(schoolId)
    } catch (err) {
      console.error('Failed to add teacher:', err)
      setAddTeacherError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setAddingTeacher(false)
    }
  }

  function startEditTeacher(t) {
    setEditingTeacherId(t.id)
    setEditTeacherFirstName(t.first_name)
    setEditTeacherLastName(t.last_name)
    setEditTeacherEmail(t.email || '')
  }

  function explainPhoneChange() {
    window.alert(
      "A teacher's phone number is also their login  it can't be edited directly.\n\n"
      + "To change it: delete this teacher, then use \"Add Teacher\" again with their new number. "
      + "This creates a fresh login and a new teacher record  you'll need to reassign them to their class(es) afterward."
    )
  }


  async function handleSaveTeacher(teacherId) {
    setSavingTeacherId(teacherId)
    setTeacherActionError('')
    try {
      await client.graphql({
        query: updateTeacherMutation,
        variables: {
          input: {
            id: teacherId,
            first_name: editTeacherFirstName,
            last_name: editTeacherLastName,
            email: editTeacherEmail || null,
            updated_at: new Date().toISOString(),
          },
        },
      })
      setEditingTeacherId(null)
      await loadTeachers(schoolId)
    } catch (err) {
      console.error('Failed to update teacher:', err)
      setTeacherActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setSavingTeacherId(null)
    }
  }

  async function handleDeleteTeacher(teacherId, teacherName) {
    const classesAssigned = classes.filter((c) => c.teacher_id === teacherId)
    const warning = classesAssigned.length > 0
      ? `"${teacherName}" is currently assigned to ${classesAssigned.length} class(es), which will show as Unassigned afterward. `
      : ''
    const confirmed = window.confirm(`${warning}Remove "${teacherName}"? Their login will still work, but they'll no longer appear in class assignment.`)
    if (!confirmed) return

    setDeletingTeacherId(teacherId)
    setTeacherActionError('')
    try {
      await client.graphql({
        query: deleteTeacherMutation,
        variables: { input: { id: teacherId } },
      })
      await loadTeachers(schoolId)
      await loadClasses(schoolId)
    } catch (err) {
      console.error('Failed to delete teacher:', err)
      setTeacherActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setDeletingTeacherId(null)
    }
  }

  async function handleAddClass(e) {
    e.preventDefault()
    setAddingClass(true)
    setAddClassError('')
    try {
      const now = new Date().toISOString()
      await client.graphql({
        query: createClassMutation,
        variables: {
          input: {
            school_id: schoolId,
            name: newClassName,
            grade: newClassGrade,
            stream: newClassStream || null,
            teacher_id: newClassTeacherId || null,
            created_at: now,
            updated_at: now,
          },
        },
      })
      setNewClassName('')
      setNewClassGrade('')
      setNewClassStream('')
      setNewClassTeacherId('')
      await loadClasses(schoolId)
    } catch (err) {
      console.error('Failed to add class:', err)
      setAddClassError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setAddingClass(false)
    }
  }

  async function handleReassignTeacher(classId, newTeacherId) {
    setReassigningClassId(classId)
    setClassActionError('')
    try {
      await client.graphql({
        query: updateClassTeacherMutation,
        variables: {
          input: {
            id: classId,
            teacher_id: newTeacherId || null,
            updated_at: new Date().toISOString(),
          },
        },
      })
      await loadClasses(schoolId)
    } catch (err) {
      console.error('Failed to reassign teacher:', err)
      setClassActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setReassigningClassId(null)
    }
  }

  async function handleDeleteClass(classId, className) {
    setClassActionError('')
    try {
      // limit is applied before the filter, so an empty page doesn't mean an
      // empty class -- keep paging until we find a student or run out.
      let hasStudents = false
      let nextToken = null
      do {
        const countRes = await client.graphql({
          query: countStudentsInClassQuery,
          variables: { classId, nextToken },
        })
        hasStudents = countRes.data.listStudents.items.length > 0
        nextToken = countRes.data.listStudents.nextToken
      } while (!hasStudents && nextToken)
      if (hasStudents) {
        setClassActionError(
          `Can't delete "${className}" — it still has students in it. Move them to another class first.`
        )
        return
      }
    } catch (err) {
      console.error('Failed to check class for students before delete:', err)
      setClassActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
      return
    }

    const confirmed = window.confirm(`Delete class "${className}"? This cannot be undone.`)
    if (!confirmed) return

    setDeletingClassId(classId)
    try {
      await client.graphql({
        query: deleteClassMutation,
        variables: { input: { id: classId } },
      })
      await loadClasses(schoolId)
    } catch (err) {
      console.error('Failed to delete class:', err)
      setClassActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setDeletingClassId(null)
    }
  }

  function startEditClass(c) {
    setEditingClassId(c.id)
    setEditClassName(c.name)
    setEditClassGrade(c.grade)
    setEditClassStream(c.stream || '')
  }

  async function handleSaveClass(classId) {
    setSavingClassId(classId)
    setClassActionError('')
    try {
      await client.graphql({
        query: updateClassMutation,
        variables: {
          input: {
            id: classId,
            name: editClassName,
            grade: editClassGrade,
            stream: editClassStream || null,
            updated_at: new Date().toISOString(),
          },
        },
      })
      setEditingClassId(null)
      await loadClasses(schoolId)
    } catch (err) {
      console.error('Failed to update class:', err)
      setClassActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setSavingClassId(null)
    }
  }

  async function handleMoveStudent(studentId, newClassId) {
    setMovingStudentId(studentId)
    setStudentActionError('')
    try {
      await client.graphql({
        query: moveStudentMutation,
        variables: {
          input: { id: studentId, class_id: newClassId || null, updated_at: new Date().toISOString() },
        },
      })
      await loadAllStudents(schoolId)
    } catch (err) {
      console.error('Failed to move student:', err)
      setStudentActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setMovingStudentId(null)
    }
  }

  async function handleBulkMove() {
    if (selectedStudentIds.length === 0 || !bulkTargetClassId) return
    setBulkMoving(true)
    setStudentActionError('')
    try {
      const now = new Date().toISOString()
      for (const studentId of selectedStudentIds) {
        await client.graphql({
          query: moveStudentMutation,
          variables: { input: { id: studentId, class_id: bulkTargetClassId, updated_at: now } },
        })
      }
      setSelectedStudentIds([])
      setBulkTargetClassId('')
      await loadAllStudents(schoolId)
    } catch (err) {
      console.error('Bulk move failed partway through:', err)
      setStudentActionError(
        (err.errors?.map((e) => e.message).join('; ') || err.message)
        + ' — some students may have already moved before this error. Check the list below.'
      )
      await loadAllStudents(schoolId)
    } finally {
      setBulkMoving(false)
    }
  }

  function toggleStudentSelection(studentId) {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    )
  }

  async function handleRemoveStudent(studentId, studentName) {
    const confirmed = window.confirm(`Remove "${studentName}" from all classes? Their records are kept, but they won't appear on any roster.`)
    if (!confirmed) return

    setMovingStudentId(studentId)
    setStudentActionError('')
    try {
      await client.graphql({
        query: moveStudentMutation,
        variables: {
          input: { id: studentId, class_id: null, status: 'INACTIVE', updated_at: new Date().toISOString() },
        },
      })
      await loadAllStudents(schoolId)
    } catch (err) {
      console.error('Failed to remove student:', err)
      setStudentActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setMovingStudentId(null)
    }
  }

  async function handleAddStudent(e) {
    e.preventDefault()
    setAddingStudent(true)
    setStudentActionError('')
    try {
      const now = new Date().toISOString()
      await client.graphql({
        query: createStudentWithClassMutation,
        variables: {
          input: {
            school_id: schoolId,
            class_id: newStudentClassId,
            first_name: newStudentFirstName,
            last_name: newStudentLastName,
            guardian_phone: newStudentPhone || null,
            status: 'ACTIVE',
            created_at: now,
            updated_at: now,
          },
        },
      })
      setNewStudentFirstName('')
      setNewStudentLastName('')
      setNewStudentPhone('')
      setNewStudentClassId('')
      await loadAllStudents(schoolId)
    } catch (err) {
      console.error('Failed to add student:', err)
      setStudentActionError(err.errors?.map((e) => e.message).join('; ') || err.message)
    } finally {
      setAddingStudent(false)
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Classes & Teachers</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/admin')} style={{ fontSize: 12, padding: '4px 10px' }}>
            Back to Dashboard
          </button>
          <button
            onClick={async () => {
              await signOut()
              navigate('/login')
            }}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 24 }}>
        <h4>Teachers</h4>
        {teachersLoading && <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>}
        {teachersError && <p style={{ color: 'red', fontSize: 13 }}>{teachersError}</p>}
        {teacherActionError && <p style={{ color: 'red', fontSize: 13 }}>{teacherActionError}</p>}
        {!teachersLoading && !teachersError && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Name</th>
                <th>Phone (login)</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
                  {editingTeacherId === t.id ? (
                    <>
                      <td style={{ padding: '6px 0' }}>
                        <input value={editTeacherFirstName} onChange={(e) => setEditTeacherFirstName(e.target.value)} style={{ padding: 4, width: 90, marginRight: 4 }} />
                        <input value={editTeacherLastName} onChange={(e) => setEditTeacherLastName(e.target.value)} style={{ padding: 4, width: 90 }} />
                      </td>
                      <td style={{ fontSize: 12, color: '#888' }}>{t.phone_number || '—'}</td>
                      <td>
                        <input value={editTeacherEmail} onChange={(e) => setEditTeacherEmail(e.target.value)} style={{ padding: 4, width: 140 }} />
                      </td>
                      <td>
                        <button onClick={() => handleSaveTeacher(t.id)} disabled={savingTeacherId === t.id} style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }}>
                          {savingTeacherId === t.id ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingTeacherId(null)} style={{ fontSize: 11, padding: '4px 8px' }}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '6px 0' }}>{t.first_name} {t.last_name}</td>
                      <td style={{ fontSize: 12 }}>
                        {t.phone_number || '—'}{' '}
                        <button onClick={explainPhoneChange} style={{ fontSize: 10, padding: '1px 4px' }} title="How to change this">ⓘ</button>
                      </td>
                      <td>{t.email || '—'}</td>
                      <td>
                        <button onClick={() => startEditTeacher(t)} style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }}>Edit</button>
                        <button
                          onClick={() => handleDeleteTeacher(t.id, `${t.first_name} ${t.last_name}`)}
                          disabled={deletingTeacherId === t.id}
                          style={{ fontSize: 11, padding: '4px 8px', color: '#c00' }}
                        >
                          {deletingTeacherId === t.id ? 'Removing…' : 'Delete'}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {teachers.length === 0 && (
                <tr>
                  <td colSpan={4} className="subtext" style={{ padding: '12px 6px', fontSize: 13, color: '#888' }}>
                    No teachers added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <form onSubmit={handleAddTeacher} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>First name</label>
            <input value={newTeacherFirstName} onChange={(e) => setNewTeacherFirstName(e.target.value)} required style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Last name</label>
            <input value={newTeacherLastName} onChange={(e) => setNewTeacherLastName(e.target.value)} required style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Phone number</label>
            <input
              value={newTeacherPhone}
              onChange={(e) => setNewTeacherPhone(e.target.value)}
              placeholder="+2547XXXXXXXX"
              required
              style={{ padding: 6 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Email (optional)</label>
            <input value={newTeacherEmail} onChange={(e) => setNewTeacherEmail(e.target.value)} style={{ padding: 6 }} />
          </div>
          <button type="submit" disabled={addingTeacher} style={{ padding: '6px 12px' }}>
            {addingTeacher ? 'Creating account…' : 'Add Teacher'}
          </button>
        </form>
        <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          This creates a real login for the teacher. You'll be shown a temporary password to give them.
        </p>
        {addTeacherError && <p style={{ color: 'red', fontSize: 13, marginTop: 8 }}>{addTeacherError}</p>}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 }}>
        <h4>Classes</h4>
        {classesLoading && <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>}
        {classesError && <p style={{ color: 'red', fontSize: 13 }}>{classesError}</p>}
        {classActionError && <p style={{ color: 'red', fontSize: 13 }}>{classActionError}</p>}
        {!classesLoading && !classesError && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Name</th>
                <th>Grade</th>
                <th>Stream</th>
                <th>Teacher</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                  {editingClassId === c.id ? (
                    <>
                      <td style={{ padding: '6px 0' }}>
                        <input value={editClassName} onChange={(e) => setEditClassName(e.target.value)} style={{ padding: 4, width: 100 }} />
                      </td>
                      <td>
                        <input value={editClassGrade} onChange={(e) => setEditClassGrade(e.target.value)} style={{ padding: 4, width: 70 }} />
                      </td>
                      <td>
                        <input value={editClassStream} onChange={(e) => setEditClassStream(e.target.value)} style={{ padding: 4, width: 70 }} />
                      </td>
                      <td colSpan={2}>
                        <button onClick={() => handleSaveClass(c.id)} disabled={savingClassId === c.id} style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }}>
                          {savingClassId === c.id ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingClassId(null)} style={{ fontSize: 11, padding: '4px 8px' }}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '6px 0' }}>{c.name}</td>
                      <td>{c.grade}</td>
                      <td>{c.stream || '—'}</td>
                      <td>
                        <select
                          value={c.teacher_id || ''}
                          disabled={reassigningClassId === c.id}
                          onChange={(e) => handleReassignTeacher(c.id, e.target.value)}
                          style={{ padding: 4 }}
                        >
                          <option value="">Unassigned</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button onClick={() => startEditClass(c)} style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }}>Edit</button>
                        <button
                          onClick={() => handleDeleteClass(c.id, c.name)}
                          disabled={deletingClassId === c.id}
                          style={{ fontSize: 11, padding: '4px 8px', color: '#c00' }}
                        >
                          {deletingClassId === c.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {classes.length === 0 && (
                <tr>
                  <td colSpan={5} className="subtext" style={{ padding: '12px 6px', fontSize: 13, color: '#888' }}>
                    No classes added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <form onSubmit={handleAddClass} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Class name</label>
            <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} required style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Grade</label>
            <input value={newClassGrade} onChange={(e) => setNewClassGrade(e.target.value)} required style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Stream (optional)</label>
            <input value={newClassStream} onChange={(e) => setNewClassStream(e.target.value)} style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Teacher (optional)</label>
            <select value={newClassTeacherId} onChange={(e) => setNewClassTeacherId(e.target.value)} style={{ padding: 6 }}>
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={addingClass} style={{ padding: '6px 12px' }}>
            {addingClass ? 'Adding…' : 'Add Class'}
          </button>
        </form>
        {addClassError && <p style={{ color: 'red', fontSize: 13, marginTop: 8 }}>{addClassError}</p>}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 }}>
        <h4>Students</h4>
        {studentsLoading && <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>}
        {studentsError && <p style={{ color: 'red', fontSize: 13 }}>{studentsError}</p>}
        {studentActionError && <p style={{ color: 'red', fontSize: 13 }}>{studentActionError}</p>}

        {!studentsLoading && !studentsError && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <select
                value={bulkTargetClassId}
                onChange={(e) => setBulkTargetClassId(e.target.value)}
                style={{ padding: 6 }}
              >
                <option value="">Move selected to…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={handleBulkMove}
                disabled={selectedStudentIds.length === 0 || !bulkTargetClassId || bulkMoving}
                style={{ padding: '6px 12px' }}
              >
                {bulkMoving ? 'Moving…' : `Move ${selectedStudentIds.length || ''} Selected`}
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th></th>
                  <th>Student</th>
                  <th>Current Class</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {allStudents.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.includes(s.id)}
                        onChange={() => toggleStudentSelection(s.id)}
                      />
                    </td>
                    <td style={{ padding: '6px 0' }}>{s.first_name} {s.last_name}</td>
                    <td>
                      <select
                        value={s.class_id || ''}
                        disabled={movingStudentId === s.id}
                        onChange={(e) => handleMoveStudent(s.id, e.target.value)}
                        style={{ padding: 4 }}
                      >
                        <option value="">Unassigned</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ fontSize: 12, color: s.status === 'INACTIVE' ? '#c00' : '#080' }}>
                      {s.status || 'ACTIVE'}
                    </td>
                    <td>
                      <button
                        onClick={() => handleRemoveStudent(s.id, `${s.first_name} ${s.last_name}`)}
                        disabled={movingStudentId === s.id}
                        style={{ fontSize: 11, padding: '4px 8px', color: '#c00' }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {allStudents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="subtext" style={{ padding: '12px 6px', fontSize: 13, color: '#888' }}>
                      No students added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        <form onSubmit={handleAddStudent} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>First name</label>
            <input value={newStudentFirstName} onChange={(e) => setNewStudentFirstName(e.target.value)} required style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Last name</label>
            <input value={newStudentLastName} onChange={(e) => setNewStudentLastName(e.target.value)} required style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Guardian phone (optional)</label>
            <input value={newStudentPhone} onChange={(e) => setNewStudentPhone(e.target.value)} placeholder="+2547XXXXXXXX" style={{ padding: 6 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block' }}>Class</label>
            <select value={newStudentClassId} onChange={(e) => setNewStudentClassId(e.target.value)} required style={{ padding: 6 }}>
              <option value="">Select a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={addingStudent} style={{ padding: '6px 12px' }}>
            {addingStudent ? 'Adding…' : 'Add Student'}
          </button>
        </form>
      </div>
    </div>
  )
}