with open('/opt/python/test_cuda/digital_human_cartoon/digitalHuman/agent/core/__init__.py', 'r') as f:
    content = f.read()

if 'longcatAgent' not in content:
    old = 'from .cozeAgent import CozeApiAgent'
    new = 'from .cozeAgent import CozeApiAgent\nfrom .longcatAgent import LongcatAgent'
    content = content.replace(old, new)
    # also add to __all__ if needed
    with open('/opt/python/test_cuda/digital_human_cartoon/digitalHuman/agent/core/__init__.py', 'w') as f:
        f.write(content)
    print('Added LongcatAgent import')
else:
    print('Already imported')

print(open('/opt/python/test_cuda/digital_human_cartoon/digitalHuman/agent/core/__init__.py').read())
