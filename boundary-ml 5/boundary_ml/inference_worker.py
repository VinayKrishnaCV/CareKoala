"""One local inference; exiting releases all model memory before OCR can start."""
import sys
from .schemas import AnalyzeRequest

def main():
    from .trained_model import TrainedModel
    request = AnalyzeRequest.model_validate_json(sys.stdin.read())
    with TrainedModel() as model:
        result=model.analyze(request)
    print(result.model_dump_json())

if __name__ == "__main__":
    main()
