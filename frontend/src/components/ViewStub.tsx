interface ViewStubProps {
  testId: string
  children: string
}

function ViewStub({ testId, children }: ViewStubProps) {
  return (
    <div
      className="rounded-card border border-card-border bg-card p-7"
      data-testid={testId}
    >
      <p className="text-sm text-muted">{children}</p>
    </div>
  )
}

export default ViewStub
